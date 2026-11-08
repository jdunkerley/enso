package org.enso.runner;

import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import org.enso.common.ContextFactory;
import org.enso.distribution.DistributionManager;
import org.enso.distribution.Environment;
import org.enso.pkg.Template;
import org.enso.polyglot.PolyglotContext;
import org.graalvm.polyglot.Context;

/**
 * The standby warm-up (Note [Standby Mode] in {@link Standby}): a project made from the default
 * template in a fresh folder under the system temporary directory, whose `Main` imports the
 * template's libraries, builds a table, filters, aggregates and sorts it, and prepares a table
 * visualization of the result. The context is closed and the folder deleted afterwards, also when
 * the warm-up fails or is cancelled. The libraries' IR caches are read from (and, when missing,
 * written to) the usual data directory, as an open would; the project's own IR cache, which the
 * compiler writes there too ({@code cache/ir/local/<PROJECT_NAME>}), is deleted with the folder.
 */
final class StandbyWarmUp implements Standby.WarmUp {
  /** Reserved: no user project is likely to share its IR cache folder ({@link #run()}). */
  static final String PROJECT_NAME = "Enso_Standby_Warm_Up";

  /** The stderr line printed once the warm-up's context runs Enso code. */
  static final String RUNNING = "standby: warm-up running";

  /** The stderr line printed once the warm-up's `main` has returned (not when it was cancelled). */
  static final String FINISHED = "standby: warm-up finished";

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
  private final Path projectIrCache;
  private final AtomicReference<Context> running = new AtomicReference<>();
  private final CountDownLatch cancelClosed = new CountDownLatch(1);
  private volatile boolean cancelled;

  StandbyWarmUp() {
    this(
        null,
        new DistributionManager(new Environment() {})
            .LocallyInstalledDirectories().irCacheDirectory());
  }

  /**
   * @param temporaryParent where the temporary project folder goes; {@code null} for the system
   *     temporary directory
   * @param irCacheDirectory the IR cache directory the compiler writes project caches to (as {@code
   *     ModuleCache} computes it); {@code null} when nothing is to be deleted there
   */
  StandbyWarmUp(Path temporaryParent, Path irCacheDirectory) {
    this.temporaryParent = temporaryParent;
    this.projectIrCache =
        irCacheDirectory == null ? null : irCacheDirectory.resolve("local").resolve(PROJECT_NAME);
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
      Throwable primary = null;
      try {
        // A cancel that came before `running` was set did not see the context: stop here. One
        // that comes after closes it, and `execute` throws.
        if (cancelled) {
          return;
        }
        System.err.println(RUNNING);
        var module =
            new PolyglotContext(context).getTopScope().getModule("local." + PROJECT_NAME + ".Main");
        var main = module.getMethod(module.getAssociatedType(), "main");
        if (main.isEmpty()) {
          throw new IllegalStateException("the warm-up project has no main");
        }
        var result = main.get().execute();
        System.err.println(FINISHED);
        if (!result.isString()) {
          throw new IllegalStateException("the warm-up returned " + result);
        }
      } catch (Throwable t) {
        primary = t;
        throw t;
      } finally {
        var still = running.getAndSet(null);
        if (still != null) {
          // `close(true)`: after a failure a guest thread may still be inside, which `close()`
          // refuses with an exception that would hide the failure and leave the context open.
          try {
            still.close(true);
          } catch (RuntimeException e) {
            if (primary != null) {
              primary.addSuppressed(e);
            } else {
              System.err.println("standby: warning: could not close the warm-up's context: " + e);
            }
          }
        } else {
          // `cancel` took the context: its files are open until its close is over.
          cancelClosed.await();
        }
      }
    } finally {
      try {
        deleteRecursively(directory);
      } finally {
        if (projectIrCache != null && Files.exists(projectIrCache)) {
          deleteRecursively(projectIrCache);
        }
      }
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
    deleteRecursively(directory, System.err);
  }

  /**
   * Delete {@code directory} and everything under it, as much as can be deleted: a file that cannot
   * be (one still open on Windows) is skipped, and one warning line names how many were left and
   * the first failure.
   *
   * @return how many files and folders could not be deleted
   */
  static int deleteRecursively(Path directory, PrintStream err) {
    var failures = new ArrayList<IOException>();
    try {
      Files.walkFileTree(
          directory,
          new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
              delete(file);
              return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
              failures.add(exc);
              return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
              if (exc != null) {
                failures.add(exc);
              }
              delete(dir);
              return FileVisitResult.CONTINUE;
            }

            private void delete(Path path) {
              try {
                Files.deleteIfExists(path);
              } catch (IOException e) {
                failures.add(e);
              }
            }
          });
    } catch (IOException e) {
      failures.add(e);
    }
    if (!failures.isEmpty()) {
      err.println(
          "standby: warning: could not delete "
              + failures.size()
              + " path(s) under "
              + directory
              + ", the first: "
              + failures.get(0));
    }
    return failures.size();
  }
}
