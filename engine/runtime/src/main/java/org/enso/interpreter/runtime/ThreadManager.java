package org.enso.interpreter.runtime;

import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.ThreadLocalAction;
import com.oracle.truffle.api.TruffleLanguage.Env;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.enso.interpreter.runtime.control.ThreadInterruptedException;

/** Manages threads running guest code, exposing a safepoint-like functionality. */
public final class ThreadManager extends GuestCodeExecutor {
  /** The value of {@link Task#deferredSince} outside a {@link #suspendInterrupts} section. */
  private static final long NOT_DEFERRED = -1;

  private final ThreadExecutors threads;

  /** The task each guest thread is running. See Note [A Thread Interrupt Is Sticky]. */
  private final ConcurrentHashMap<Thread, Task> tasks = new ConcurrentHashMap<>();

  /** How many times {@link #interruptThreads} has been called. */
  private final AtomicLong interrupts = new AtomicLong();

  ThreadManager(ThreadExecutors th, int throughput, Env env) {
    super(th.newScheduledThreadPool(throughput, "guest-code", false));
    this.threads = th;
  }

  /** The interrupt state of the task a guest thread is running. */
  private static final class Task {
    /** Set by {@link #interruptThreads}, never cleared: the task ends instead. */
    volatile boolean interrupted;

    /**
     * The value of {@link #interrupts} when the current {@link #suspendInterrupts} section began,
     * or {@link #NOT_DEFERRED}. Only the task's own thread reads and writes it.
     */
    long deferredSince = NOT_DEFERRED;

    /**
     * Whether an {@link Interrupt} was deferred and must be submitted again when the section ends.
     * Only the task's own thread reads and writes it.
     */
    boolean parked;
  }

  @Override
  protected Runnable wrap(Runnable r) {
    Runnable wrap =
        () -> {
          var notYetEntered = tasks.get(Thread.currentThread()) == null;
          if (notYetEntered) {
            tasks.put(Thread.currentThread(), new Task());
            try {
              r.run();
            } finally {
              tasks.remove(Thread.currentThread());
            }
          } else {
            r.run();
          }
        };
    return wrap;
  }

  @Override
  protected <V> Callable<V> wrap(Callable<V> c) {
    Callable<V> wrap =
        () -> {
          var notYetEntered = tasks.get(Thread.currentThread()) == null;
          if (notYetEntered) {
            tasks.put(Thread.currentThread(), new Task());
            try {
              return c.call();
            } finally {
              tasks.remove(Thread.currentThread());
            }
          } else {
            return c.call();
          }
        };
    return wrap;
  }

  /**
   * Schedules a computation of provided action on one of available <em>guest threads</em>.
   *
   * @param <T> type of the value to operate on
   * @param action the action to perform to obtain a value
   * @return observable future filled with the computed value
   */
  public final <T> CompletableFuture<T> submit(Supplier<T> action) {
    var notYetEntered = tasks.get(Thread.currentThread()) == null;
    if (notYetEntered) {
      Supplier<T> wrap =
          () -> {
            tasks.put(Thread.currentThread(), new Task());
            try {
              return action.get();
            } finally {
              tasks.remove(Thread.currentThread());
            }
          };
      return CompletableFuture.supplyAsync(wrap, guestCode);
    } else {
      try {
        return CompletableFuture.completedFuture(action.get());
      } catch (Exception ex) {
        return CompletableFuture.failedFuture(ex);
      }
    }
  }

  /**
   * Creates new cached pool of system threads associated with this context.
   *
   * @param name human-readable name of the pool
   * @param min minimal number of threads kept-alive in the pool
   * @param max maximal number of available threads
   * @param maxQueueSize maximal number of pending tasks
   * @return new execution service for this context
   */
  public ExecutorService newCachedThreadPool(String name, int min, int max, int maxQueueSize) {
    // only allow creation of systemThreads
    // non-system threads have to be managed and controlled internally
    return threads.newCachedThreadPool(name, true, min, max, maxQueueSize);
  }

  /**
   * Creates new fixed pool of system threads associated with this context.
   *
   * @param parallel amount of parallelism for the pool
   * @param name human-readable name of the pool
   * @return new execution service for this context
   */
  public ScheduledExecutorService newFixedThreadPool(int parallel, String name) {
    // only allow creation of systemThreads
    // non-system threads have to be managed and controlled internally
    return threads.newScheduledThreadPool(parallel, name, true);
  }

  /**
   * Forces all threads managed by this system to halt at the next safepoint (i.e. a {@link #poll()}
   * call) and throw a {@link ThreadInterruptedException}.
   *
   * <p>This method is blocking, does not return until the last managed thread reports at a
   * safepoint.
   *
   * <p>The interrupt is sticky: a thread keeps being interrupted at its safepoints until the task
   * it was running ends. See Note [A Thread Interrupt Is Sticky].
   *
   * <p>This method may not be called from a thread that is itself managed by this system, as doing
   * so may result in a deadlock.
   */
  public final void interruptThreads() {
    interrupts.incrementAndGet();
    tasks.values().forEach(task -> task.interrupted = true);
    submitThreadLocal(null, new Interrupt());
  }

  /**
   * Whether the current thread runs a guest task that {@link #interruptThreads} has interrupted.
   * Code that catches an exception on a guest thread uses it to tell a failure the interrupt caused
   * from a real one.
   *
   * @return {@code true} if the current task has been interrupted; {@code false} if it has not, or
   *     if the current thread runs no guest task
   */
  @CompilerDirectives.TruffleBoundary
  public boolean isInterrupted() {
    var task = tasks.get(Thread.currentThread());
    return task != null && task.interrupted;
  }

  /**
   * Defers, until {@link #resumeInterrupts}, the interrupts already requested of the current thread.
   * Use it in a {@code try}/{@code finally}:
   *
   * <pre>
   * var resume = threadManager.suspendInterrupts();
   * try {
   *   // code that must finish
   * } finally {
   *   threadManager.resumeInterrupts(resume);
   * }
   * </pre>
   *
   * <p>Exactly what is deferred: the {@link ThreadInterruptedException} of every {@link
   * #interruptThreads} call made before this one, including the throws that re-arm it. One that is
   * due inside the section is delivered at the first safepoint after {@link #resumeInterrupts}.
   * Nothing else is deferred: an {@link #interruptThreads} call made after this one throws at the
   * next safepoint as usual, cutting the section short, and other thread-local actions and
   * cancelling or closing the context are not affected. Sections nest. On a thread that runs no
   * guest task this does nothing.
   *
   * <p>For guest code that has to run while an interrupt unwinds the thread, such as an interrupt
   * handler or the destructor of a resource. See Note [A Thread Interrupt Is Sticky].
   *
   * @return the value to pass to {@link #resumeInterrupts}
   */
  @CompilerDirectives.TruffleBoundary
  public long suspendInterrupts() {
    var task = tasks.get(Thread.currentThread());
    if (task == null) {
      return NOT_DEFERRED;
    }
    var outer = task.deferredSince;
    task.deferredSince = interrupts.get();
    return outer;
  }

  /**
   * Ends a {@link #suspendInterrupts} section. If an interrupt was deferred in it, it is submitted
   * again, so it is delivered at the next safepoint (or deferred again by an enclosing section that
   * covers it).
   *
   * @param resume the value {@link #suspendInterrupts} returned
   */
  @CompilerDirectives.TruffleBoundary
  public void resumeInterrupts(long resume) {
    var thread = Thread.currentThread();
    var task = tasks.get(thread);
    if (task == null) {
      return;
    }
    task.deferredSince = resume;
    if (task.parked) {
      task.parked = false;
      submitThreadLocal(new Thread[] {thread}, new Interrupt());
    }
  }

  /* Note [A Thread Interrupt Is Sticky]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `interruptThreads` flags the task of every guest thread and submits
   * `Interrupt`, which throws `ThreadInterruptedException` at the thread's next
   * safepoint. On GraalVM 25.5, first-tier compiled code can lose that exception:
   * the action runs and throws, and the compiled loop carries on as if nothing had
   * been thrown (#834). A one-shot interrupt then leaves the thread running for
   * ever.
   *
   * So the action re-arms itself on the thread before it throws, and keeps doing
   * so for as long as the task is flagged. The flag is dropped only when the task
   * ends (`wrap` and `submit` remove its `Task`), so a lost exception is thrown
   * again at the next safepoint, and a task that has been interrupted cannot run
   * guest code to completion. A re-armed action left pending when the task ends
   * finds no `Task`, or the next task's unset flag, and does nothing.
   *
   * The price is that an interrupt is no longer one-shot within a task. Guest code
   * that has to run while the interrupt unwinds the thread, such as a
   * `Thread.with_interrupt_handler` handler or the destructor of
   * `Managed_Resource.bracket`, would be interrupted again at its first poll, so
   * it runs between `suspendInterrupts` and `resumeInterrupts`. They defer only
   * the interrupts requested before the section began: `interruptThreads` counts
   * its calls, the section records the count, and an `Interrupt` that finds the
   * count unchanged parks itself (no throw, no re-arm) for `resumeInterrupts` to
   * submit again. A later `interruptThreads` call changes the count, so its action
   * throws, and a handler or destructor that never ends can still be stopped by
   * interrupting again, as before the re-arm. Truffle's
   * `setAllowSideEffects(false)` would defer that later interrupt too, leaving
   * only the cancelling or closing of the context.
   *
   * The count is shared by all threads rather than kept per thread, because
   * `interruptThreads` always interrupts every guest thread: per-thread counts
   * would move together, and an action on a thread whose task is not flagged does
   * nothing whatever the count. An interrupt requested in the instant between the
   * delivery of the one being handled and the start of the section is merged with
   * it and deferred too.
   *
   * Finalizers do not use this: they keep `setAllowSideEffects(false)` (Note [A
   * Finalizer Delays Thread Interrupts] in `ResourceManager`), which defers new
   * interrupts as well. A finalizer is never run again, so any interrupt that cut
   * one short, new or not, would leak its resource.
   *
   * Every other place that catches the exception either rethrows it or runs on a
   * thread that is not a guest thread (the instrument's jobs wait for the guest
   * task to fail); code that swallows it and runs more guest code in the same task
   * is interrupted again, which is the point.
   */
  private final class Interrupt extends ThreadLocalAction {
    Interrupt() {
      super(true, false);
    }

    @Override
    protected void perform(ThreadLocalAction.Access access) {
      // Note [A Thread Interrupt Is Sticky]
      var thread = access.getThread();
      var task = tasks.get(thread);
      if (task == null || !task.interrupted) {
        return;
      }
      if (task.deferredSince == interrupts.get()) {
        task.parked = true;
        return;
      }
      submitThreadLocal(new Thread[] {thread}, new Interrupt());
      throw new ThreadInterruptedException();
    }
  }

  /** Requests that all threads are shutdown. */
  @Override
  public final void shutdown() {
    threads.shutdown();
    var hasBeenInterrupted = Thread.interrupted();
    for (var t : tasks.keySet()) {
      try {
        t.join();
      } catch (InterruptedException e) {
        hasBeenInterrupted = true;
      }
    }
    if (hasBeenInterrupted) {
      Thread.currentThread().interrupt();
    }
  }

  /**
   * Invokes {@link Env#submitThreadLocal}.
   *
   * @param threads {@code null} or list of threads to execute action at
   * @param action the action to execute at given threads
   * @return future to check whether action has been executed
   */
  public final Future<Void> submitThreadLocal(Thread[] threads, ThreadLocalAction action) {
    return this.threads.submitThreadLocal(threads, action);
  }

  final Thread createThread(boolean systemThread, Runnable run) {
    return this.threads.createThread(systemThread, run);
  }
}
