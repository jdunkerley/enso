package org.enso.runner;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import org.enso.common.ContextFactory;
import org.enso.pkg.Template;
import org.enso.polyglot.PolyglotContext;
import org.graalvm.polyglot.Context;

/**
 * The standby warm-up (Note [Standby Mode] in {@link Standby}): a project made from the default
 * template in a fresh folder under the system temporary directory, whose `Main` imports the
 * template's libraries, builds a table, filters, aggregates and sorts it, and prepares a table
 * visualization of the result. The context is closed and the folder deleted afterwards, also when
 * the warm-up fails or is cancelled. The libraries' IR caches are read from the usual data
 * directory, as an open would.
 */
final class StandbyWarmUp implements Standby.WarmUp {
  static final String PROJECT_NAME = "Warm_Up";

  /** The default template's imports (Standard.Database and Standard.Examples included). */
  static final String MAIN_SOURCE =
      """
      from Standard.Base import all
      from Standard.Table import all
      from Standard.Database import all
      import Standard.Examples
      import Standard.Visualization
      import Standard.Visualization.Table.Visualization as Table_Visualization

      main =
          numbers = 0.up_to 2000 . to_vector
          keys = numbers.map i-> "K" + (i % 17).to_text
          values = numbers.map i-> (i * 37) % 101
          ratios = numbers.map i-> i / 7
          table = Table.new [["Key", keys], ["Value", values], ["Ratio", ratios]]
          filtered = table.filter "Value" (Filter_Condition.Greater than=10)
          totals = filtered.aggregate ["Key"] [Aggregate_Column.Sum "Value", Aggregate_Column.Average "Ratio", Aggregate_Column.Count]
          sorted = totals.sort [..Name "Key"]
          Table_Visualization.prepare_visualization sorted 1000
      """;

  private final Path temporaryParent;
  private final AtomicReference<Context> running = new AtomicReference<>();
  private final CountDownLatch cancelClosed = new CountDownLatch(1);
  private volatile boolean cancelled;

  StandbyWarmUp() {
    this(null);
  }

  /**
   * @param temporaryParent where the temporary project folder goes; {@code null} for the system
   *     temporary directory
   */
  StandbyWarmUp(Path temporaryParent) {
    this.temporaryParent = temporaryParent;
  }

  @Override
  public void run() throws IOException, InterruptedException {
    if (cancelled) {
      return;
    }
    var directory =
        temporaryParent == null
            ? Files.createTempDirectory("enso-standby-")
            : Files.createTempDirectory(temporaryParent, "enso-standby-");
    try {
      var root = directory.resolve(PROJECT_NAME);
      Main.createProject(root.toFile(), PROJECT_NAME, Template.Default$.MODULE$);
      Files.writeString(root.resolve("src").resolve("Main.enso"), MAIN_SOURCE);
      if (cancelled) {
        return;
      }
      // The Language Server's options (`MainModule`), so that the libraries' IR caches it reads
      // are the ones an open reads.
      var context =
          ContextFactory.create()
              .projectRoot(root.toString())
              .workingDirectory(directory.toString())
              .logLevel(Level.WARNING)
              .strictErrors(false)
              .enableIrCaches(true)
              .disableLinting(true)
              .out(OutputStream.nullOutputStream())
              .build();
      running.set(context);
      try {
        // A cancel that came before `running` was set did not see the context: stop here. One
        // that comes after closes it, and `execute` throws.
        if (cancelled) {
          return;
        }
        var module =
            new PolyglotContext(context).getTopScope().getModule("local." + PROJECT_NAME + ".Main");
        var main = module.getMethod(module.getAssociatedType(), "main");
        if (main.isEmpty()) {
          throw new IllegalStateException("the warm-up project has no main");
        }
        var result = main.get().execute();
        if (!result.isString()) {
          throw new IllegalStateException("the warm-up returned " + result);
        }
      } finally {
        var still = running.getAndSet(null);
        if (still != null) {
          still.close();
        } else {
          // `cancel` took the context: its files are open until its close is over.
          cancelClosed.await();
        }
      }
    } finally {
      deleteRecursively(directory);
    }
  }

  /** Stops the warm-up. Safe before, during and after {@link #run()}, and more than once. */
  @Override
  public void cancel() {
    cancelled = true;
    var context = running.getAndSet(null);
    if (context != null) {
      try {
        context.close(true);
      } catch (RuntimeException e) {
        System.err.println("standby: could not close the warm-up's context: " + e);
      } finally {
        cancelClosed.countDown();
      }
    }
  }

  private static void deleteRecursively(Path directory) {
    try {
      Files.walkFileTree(
          directory,
          new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
              Files.deleteIfExists(file);
              return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc)
                throws IOException {
              Files.deleteIfExists(dir);
              return FileVisitResult.CONTINUE;
            }
          });
    } catch (IOException e) {
      System.err.println("standby: could not delete " + directory + ": " + e);
    }
  }
}
