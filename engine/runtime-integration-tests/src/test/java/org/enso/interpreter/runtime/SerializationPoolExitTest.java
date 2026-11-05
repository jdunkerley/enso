package org.enso.interpreter.runtime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.enso.editions.LibraryName;
import org.enso.test.utils.ContextUtils;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * Exit waits for a must-finish job even when an abandonable rewrite of the same library's bindings
 * cache is in the pool (`enso --compile` of a library whose old cache was rejected). See Note [A
 * Rejected Bindings Cache Is Rewritten] in {@link TruffleCompilerContext}.
 */
public class SerializationPoolExitTest {
  private static final LibraryName LIB = new LibraryName("local", "Exit_Test");

  /** Longer than `shutdown` waits for the pool to terminate once it stops waiting for jobs. */
  private static final long MUST_FINISH_MS = 7_000;

  private ContextUtils ctx;

  @Before
  public void open() {
    ctx = ContextUtils.createDefault();
    ctx.context().enter();
  }

  @After
  public void close() {
    ctx.context().leave();
    ctx.close();
  }

  @Test
  public void exitWaitsForSerializeLibraryDespiteARewriteOfTheSameLibrary() throws Exception {
    var compilerContext = (TruffleCompilerContext) ctx.ensoContext().getCompiler().context();
    var pool = new SerializationPool(compilerContext);
    var rewriteStarted = new CountDownLatch(1);
    var rewriteStopped = new AtomicBoolean();
    var mustFinishDone = new AtomicBoolean();

    // The rewrite runs first on the single serialization thread and holds it until shutdown.
    var rewriteKey = TruffleCompilerContext.rewriteKey(LIB);
    pool.submitAbandonableTask(
        () -> {
          pool.startSerializing(rewriteKey);
          try {
            rewriteStarted.countDown();
            while (!pool.isShuttingDown()) {
              Thread.sleep(10);
            }
            rewriteStopped.set(true);
            return null;
          } finally {
            pool.finishSerializing(rewriteKey);
          }
        },
        true,
        rewriteKey);
    assertTrue(rewriteStarted.await(30, TimeUnit.SECONDS));

    var libraryKey = TruffleCompilerContext.libraryKey(LIB);
    pool.submitTask(
        () -> {
          pool.startSerializing(libraryKey);
          try {
            Thread.sleep(MUST_FINISH_MS);
            mustFinishDone.set(true);
            return true;
          } finally {
            pool.finishSerializing(libraryKey);
          }
        },
        true,
        libraryKey);

    pool.shutdown(true);
    assertTrue("the rewrite was abandoned", rewriteStopped.get());
    assertTrue("exit waited for serializeLibrary", mustFinishDone.get());
    assertFalse(pool.isWaitingForSerialization(libraryKey));
  }
}
