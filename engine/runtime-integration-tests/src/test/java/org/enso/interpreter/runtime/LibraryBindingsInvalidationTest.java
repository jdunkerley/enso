package org.enso.interpreter.runtime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiPredicate;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import org.enso.compiler.test.LibraryBindingsReadOnceTest;
import org.enso.editions.LibraryName;
import org.enso.pkg.PackageManager;
import org.graalvm.polyglot.Context;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * When {@code TruffleCompilerContext.libraryBindings} reads a library's bindings cache again. See
 * Note [One Bindings Cache Read Per Library].
 *
 * <p>The races are made deterministic by holding a thread inside a log call: the handler blocks the
 * thread that logs a chosen message until the test releases it. No test sleeps.
 */
public class LibraryBindingsInvalidationTest {
  private static final String RESTORED = "Restored bindings for library [{0}].";
  private static final String SKIPPED =
      "Not using the bindings cache of [{0}], the compile target.";
  private static final String REQUESTING = "Requesting serialization for library [{0}].";
  private static final String CATALOGUE = "Written the catalogue of library [{0}]: {1} entries.";
  private static final LibraryName FIB = new LibraryName("local", "Fib_Test");
  private static final long TIMEOUT_S = 60;

  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private final GatedHandler handler = new GatedHandler();
  private Context ctx;
  private EnsoContext ensoContext;
  private TruffleCompilerContext compilerContext;
  private final List<Thread> helpers = new ArrayList<>();

  /** Starts a reader or writer thread; `close` waits for it before closing the context. */
  private Thread startHelper(Runnable body) {
    var thread = Thread.ofPlatform().start(body);
    helpers.add(thread);
    return thread;
  }

  @Before
  public void openPersistedFibTest() throws Exception {
    var pkgPath = LibraryBindingsReadOnceTest.persistedCopyOf("Fib_Test", tmp.getRoot().toPath());
    ctx = LibraryBindingsReadOnceTest.ensoContextForPackage(pkgPath, false, handler);
    ensoContext = LibraryBindingsReadOnceTest.leakContext(ctx);
    compilerContext = (TruffleCompilerContext) ensoContext.getCompiler().context();
    ctx.enter();
    // Gives the library's modules their IR, which `serializeLibrary` writes.
    var pkg = PackageManager.Default().fromDirectory(pkgPath).get();
    var main = ensoContext.getModuleForFile(pkg.mainFile()).get().asCompilerModule();
    ensoContext.getCompiler().run(main);
  }

  @After
  public void close() throws InterruptedException {
    handler.open();
    for (var helper : helpers) {
      helper.join(TimeUnit.SECONDS.toMillis(TIMEOUT_S));
    }
    if (ctx != null) {
      ctx.leave();
      ctx.close();
    }
  }

  @Test
  public void aReadIsRemembered() throws Exception {
    var before = handler.count(RESTORED);
    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertEquals("the reads came from the memo", before, handler.count(RESTORED));
  }

  @Test
  public void writingTheLibraryForgetsItsBindings() throws Exception {
    compilerContext.libraryBindings(FIB);
    var before = handler.count(RESTORED);

    assertTrue(
        "the library is written",
        compilerContext
            .serializeLibrary(ensoContext.getCompiler(), FIB)
            .get(TIMEOUT_S, TimeUnit.SECONDS));

    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertEquals("the read after the write goes to the file", before + 1, handler.count(RESTORED));
    compilerContext.libraryBindings(FIB);
    assertEquals("and is remembered", before + 1, handler.count(RESTORED));
  }

  @Test
  public void clearingForgetsTheBindings() throws Exception {
    compilerContext.libraryBindings(FIB);
    var before = handler.count(RESTORED);
    compilerContext.clearLibraryBindings();
    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertEquals(before + 1, handler.count(RESTORED));
  }

  /**
   * A read that has read the file, but not yet stored its answer, when the write starts and ends.
   * Its answer is the old file's, so it must not be remembered.
   */
  @Test
  public void aReadOverlappingTheWholeWriteIsNotRemembered() throws Exception {
    compilerContext.clearLibraryBindings();
    var readerResult = new AtomicReference<Throwable>();
    var readerThread =
        startHelper(
            () -> {
              var me = Thread.currentThread();
              ctx.enter();
              try {
                handler.gate((r, t) -> t == me && isRestored(r));
                compilerContext.libraryBindings(FIB);
              } catch (Throwable e) {
                readerResult.set(e);
              } finally {
                ctx.leave();
              }
            });
    handler.awaitArrival();

    assertTrue(
        "the library is written while the read is held",
        compilerContext
            .serializeLibrary(ensoContext.getCompiler(), FIB)
            .get(TIMEOUT_S, TimeUnit.SECONDS));
    handler.open();
    readerThread.join(TimeUnit.SECONDS.toMillis(TIMEOUT_S));
    assertFalse("the reader finished", readerThread.isAlive());
    assertNull("the reader did not fail", readerResult.get());

    var before = handler.count(RESTORED);
    compilerContext.libraryBindings(FIB);
    assertEquals("the held read's answer was not kept", before + 1, handler.count(RESTORED));
  }

  /**
   * A read that starts after the write is requested, and reads the old file before the write task
   * runs. Only the bump in the task's {@code finally} forgets its answer.
   */
  @Test
  public void aReadDuringTheWriteIsNotRemembered() throws Exception {
    var writerResult = new AtomicReference<Object>();
    var writerThread =
        startHelper(
            () -> {
              var me = Thread.currentThread();
              ctx.enter();
              try {
                handler.gate((r, t) -> t == me && isRequesting(r));
                writerResult.set(
                    compilerContext
                        .serializeLibrary(ensoContext.getCompiler(), FIB)
                        .get(TIMEOUT_S, TimeUnit.SECONDS));
              } catch (Throwable e) {
                writerResult.set(e);
              } finally {
                ctx.leave();
              }
            });
    handler.awaitArrival();

    // The write has been requested (its first generation bump is done) but not submitted: this read
    // gets the old file.
    var before = handler.count(RESTORED);
    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertEquals("the read during the write goes to the file", before + 1, handler.count(RESTORED));

    handler.open();
    writerThread.join(TimeUnit.SECONDS.toMillis(TIMEOUT_S));
    assertFalse("the writer finished", writerThread.isAlive());
    assertEquals("the library is written", Boolean.TRUE, writerResult.get());

    compilerContext.libraryBindings(FIB);
    assertEquals(
        "the answer read during the write was not kept", before + 2, handler.count(RESTORED));
  }

  /**
   * As `deserializeLibraryBindings` did, an interrupted wait for a write throws and is not kept.
   */
  @Test
  public void anInterruptedReadThrows() throws Exception {
    var writerResult = new AtomicReference<Object>();
    var writerThread =
        startHelper(
            () -> {
              ctx.enter();
              try {
                // Held after `startSerializing`, so a reader waits for the write.
                handler.gate((r, t) -> isCatalogue(r));
                writerResult.set(
                    compilerContext
                        .serializeLibrary(ensoContext.getCompiler(), FIB)
                        .get(TIMEOUT_S, TimeUnit.SECONDS));
              } catch (Throwable e) {
                writerResult.set(e);
              } finally {
                ctx.leave();
              }
            });
    handler.awaitArrival();

    Thread.currentThread().interrupt();
    try {
      compilerContext.libraryBindings(FIB);
      fail("an interrupted wait for the write throws");
    } catch (InterruptedException expected) {
      // as `deserializeLibraryBindings` did
    } finally {
      Thread.interrupted();
    }

    handler.open();
    writerThread.join(TimeUnit.SECONDS.toMillis(TIMEOUT_S));
    assertFalse("the writer finished", writerThread.isAlive());
    assertEquals("the library is written", Boolean.TRUE, writerResult.get());
    var before = handler.count(RESTORED);
    assertTrue(compilerContext.libraryBindings(FIB).isDefined());
    assertEquals(before + 1, handler.count(RESTORED));
  }

  /**
   * Note [Compile Target Skips Its Bindings Cache]: the compile target's cache is never read, and
   * the skip is asked again each time rather than remembered as "absent".
   */
  @Test
  public void theCompileTargetSkipsItsBindingsCacheEveryTime() throws Exception {
    compilerContext.clearLibraryBindings();
    var restored = handler.count(RESTORED);
    compilerContext.compilingLibrary(FIB);
    try {
      assertTrue(compilerContext.libraryBindings(FIB).isEmpty());
      assertTrue(compilerContext.libraryBindings(FIB).isEmpty());
      assertEquals("each read is skipped", 2, handler.count(SKIPPED));
      assertEquals("the cache is not read", restored, handler.count(RESTORED));
    } finally {
      compilerContext.compilingLibrary(null);
    }
    assertTrue(
        "the skip was not remembered as absent", compilerContext.libraryBindings(FIB).isDefined());
    assertEquals(restored + 1, handler.count(RESTORED));
  }

  private static boolean isRestored(LogRecord r) {
    return RESTORED.equals(r.getMessage()) && isFib(r);
  }

  private static boolean isRequesting(LogRecord r) {
    return REQUESTING.equals(r.getMessage()) && isFib(r);
  }

  private static boolean isCatalogue(LogRecord r) {
    return CATALOGUE.equals(r.getMessage()) && isFib(r);
  }

  private static boolean isFib(LogRecord r) {
    return r.getParameters() != null
        && r.getParameters().length > 0
        && FIB.toString().equals(String.valueOf(r.getParameters()[0]));
  }

  /**
   * Keeps every record, and holds the first thread to log a record that matches the gate until
   * {@link #open()}.
   */
  private static final class GatedHandler extends Handler {
    private final List<LogRecord> records = new ArrayList<>();
    private volatile BiPredicate<LogRecord, Thread> gate;
    private final CountDownLatch arrived = new CountDownLatch(1);
    private final CountDownLatch released = new CountDownLatch(1);

    void gate(BiPredicate<LogRecord, Thread> gate) {
      this.gate = gate;
    }

    void awaitArrival() throws InterruptedException {
      assertTrue(
          "a thread reached the gate: " + messages(), arrived.await(TIMEOUT_S, TimeUnit.SECONDS));
    }

    void open() {
      released.countDown();
    }

    int count(String message) {
      synchronized (records) {
        return (int)
            records.stream().filter(r -> message.equals(r.getMessage()) && isFib(r)).count();
      }
    }

    private List<String> messages() {
      synchronized (records) {
        return records.stream().map(LogRecord::getMessage).toList();
      }
    }

    @Override
    public void publish(LogRecord lr) {
      synchronized (records) {
        records.add(lr);
      }
      var g = gate;
      if (g != null && arrived.getCount() > 0 && g.test(lr, Thread.currentThread())) {
        gate = null;
        arrived.countDown();
        try {
          if (!released.await(TIMEOUT_S, TimeUnit.SECONDS)) {
            throw new IllegalStateException("the test never released the gate");
          }
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
        }
      }
    }

    @Override
    public void flush() {}

    @Override
    public void close() {}
  }
}
