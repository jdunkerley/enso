package org.enso.interpreter.instrument.job;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.enso.interpreter.instrument.execution.ReentrantLocking;
import org.junit.Test;

/** Note [Visualisations Evaluated Alone Or By Their Execution] in UpsertVisualizationJob. */
public class UpsertVisualizationLockTest {
  private final ReentrantLocking locking = new ReentrantLocking();
  private final UUID contextId = UUID.randomUUID();

  private enum Holder {
    /** An `ExecuteJob` of this context: the context read lock, then the compilation read lock. */
    EXECUTION,
    /** `SerializeModuleJob`: the compilation read lock only. */
    READER,
    /** `EnsureCompiledJob`: the compilation write lock. */
    COMPILE
  }

  private Thread hold(Holder holder, CountDownLatch held, CountDownLatch release) {
    Callable<Object> body =
        () -> {
          held.countDown();
          release.await(10, TimeUnit.SECONDS);
          return null;
        };
    var thread =
        new Thread(
            () -> {
              switch (holder) {
                case EXECUTION ->
                    locking.withReadContextLock(
                        locking.getOrCreateContextLock(contextId),
                        getClass(),
                        () -> locking.withReadCompilationLock(getClass(), body));
                case READER -> locking.withReadCompilationLock(getClass(), body);
                case COMPILE -> locking.withWriteCompilationLock(getClass(), body);
              }
            });
    thread.start();
    return thread;
  }

  /** What `evaluate` was told (null: not called), and whether the job was done. */
  private record Outcome(Boolean hadWrite, boolean done) {}

  private Outcome attachWhile(Holder holder, boolean evaluationIsEnough) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var thread = holder == null ? null : hold(holder, held, release);
    if (thread != null) assertTrue(held.await(10, TimeUnit.SECONDS));
    var hadWrite = new AtomicReference<Boolean>();
    try {
      var done =
          UpsertVisualizationJob.evaluateWithoutBlocking(
              locking,
              locking.getOrCreateContextLock(contextId),
              getClass(),
              hasWrite -> {
                hadWrite.set(hasWrite);
                return hasWrite || evaluationIsEnough;
              });
      return new Outcome(hadWrite.get(), done);
    } finally {
      release.countDown();
      if (thread != null) thread.join(10_000);
    }
  }

  @Test
  public void neverEvaluatesBesideARunningExecutionOfTheContext() throws Exception {
    var outcome = attachWhile(Holder.EXECUTION, true);
    assertNull("not evaluated beside the execution", outcome.hadWrite());
    assertFalse("deferred to the execution", outcome.done());
  }

  @Test
  public void evaluatesAloneWhileABackgroundJobOnlyReads() throws Exception {
    var outcome = attachWhile(Holder.READER, true);
    assertEquals("under the read lock", Boolean.FALSE, outcome.hadWrite());
    assertTrue("evaluated without waiting", outcome.done());
  }

  @Test
  public void defersWhenTheReadLockIsNotEnough() throws Exception {
    var outcome = attachWhile(Holder.READER, false);
    assertFalse(outcome.done());
  }

  @Test
  public void neverEvaluatesMidCompile() throws Exception {
    var outcome = attachWhile(Holder.COMPILE, true);
    assertNull(outcome.hadWrite());
    assertFalse(outcome.done());
  }

  @Test
  public void takesTheWriteLockWhenAllIsFree() throws Exception {
    var outcome = attachWhile(null, true);
    assertEquals(Boolean.TRUE, outcome.hadWrite());
    assertTrue(outcome.done());
  }
}
