package org.enso.downloader.http;

import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodySubscriber;
import java.net.http.HttpResponse.ResponseInfo;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * A {@link HttpResponse} body handler that gives up on a body that stops arriving.
 *
 * <p>If no bytes arrive for the idle timeout, the body subscription is cancelled (which closes the
 * connection, so a blocked read really ends) and the wrapped subscriber is failed with an {@link
 * HTTPException} saying so. It is an idle timeout, not a total one: a large download that keeps
 * trickling in is never cut short. See Note [A Download Waits For An Answer Only So Long] in {@link
 * HTTPDownload}.
 *
 * <p>The clock starts when the response headers have arrived (the JDK's request timeout covers only
 * the wait up to that point) and stops when the body ends.
 */
final class IdleTimeoutBodyHandler<T> implements HttpResponse.BodyHandler<T> {

  /** Checks the clocks of all the downloads in progress. */
  private static final ScheduledThreadPoolExecutor WATCHDOG = createWatchdog();

  private static ScheduledThreadPoolExecutor createWatchdog() {
    var executor =
        new ScheduledThreadPoolExecutor(
            1,
            runnable -> {
              var thread = new Thread(runnable, "download-idle-watchdog");
              thread.setDaemon(true);
              return thread;
            });
    executor.setRemoveOnCancelPolicy(true);
    return executor;
  }

  private final HttpResponse.BodyHandler<T> delegate;
  private final Duration idleTimeout;
  private final String stalledMessage;
  private volatile HTTPException stalled;

  private IdleTimeoutBodyHandler(
      HttpResponse.BodyHandler<T> delegate, Duration idleTimeout, String stalledMessage) {
    this.delegate = delegate;
    this.idleTimeout = idleTimeout;
    this.stalledMessage = stalledMessage;
  }

  /**
   * @param delegate the handler of the body
   * @param idleTimeout how long the body may go without a byte
   * @param stalledMessage the message of the error the subscriber is failed with
   */
  static <T> IdleTimeoutBodyHandler<T> of(
      HttpResponse.BodyHandler<T> delegate, Duration idleTimeout, String stalledMessage) {
    return new IdleTimeoutBodyHandler<>(delegate, idleTimeout, stalledMessage);
  }

  /**
   * The error to report if the body stalled, else null. Closing the connection makes the JDK fail
   * the response with an error of its own, which can arrive before the one given to the wrapped
   * subscriber, so whoever sends the request replaces the failure with this one.
   */
  HTTPException stalled() {
    return stalled;
  }

  @Override
  public BodySubscriber<T> apply(ResponseInfo responseInfo) {
    return new IdleSubscriber(delegate.apply(responseInfo));
  }

  private final class IdleSubscriber implements BodySubscriber<T> {
    private final BodySubscriber<T> subscriber;
    private Flow.Subscription subscription;
    private long lastActivityNanos = System.nanoTime();
    private boolean finished;
    private ScheduledFuture<?> check;

    IdleSubscriber(BodySubscriber<T> subscriber) {
      this.subscriber = subscriber;
    }

    @Override
    public synchronized void onSubscribe(Flow.Subscription subscription) {
      this.subscription = subscription;
      touch();
      var period = Math.max(10L, Math.min(1000L, idleTimeout.toMillis() / 4));
      check =
          WATCHDOG.scheduleWithFixedDelay(this::checkIdle, period, period, TimeUnit.MILLISECONDS);
      subscriber.onSubscribe(subscription);
    }

    @Override
    public synchronized void onNext(List<ByteBuffer> items) {
      if (finished) {
        return;
      }
      touch();
      subscriber.onNext(items);
      // The time spent handling the bytes is not the server's silence.
      touch();
    }

    @Override
    public synchronized void onError(Throwable throwable) {
      if (finish()) {
        subscriber.onError(throwable);
      }
    }

    @Override
    public synchronized void onComplete() {
      if (finish()) {
        subscriber.onComplete();
      }
    }

    @Override
    public CompletionStage<T> getBody() {
      return subscriber.getBody();
    }

    private void touch() {
      lastActivityNanos = System.nanoTime();
    }

    /** Ends the watch; false if it had ended already. */
    private boolean finish() {
      if (finished) {
        return false;
      }
      finished = true;
      if (check != null) {
        check.cancel(false);
      }
      return true;
    }

    private synchronized void checkIdle() {
      if (finished || System.nanoTime() - lastActivityNanos < idleTimeout.toNanos()) {
        return;
      }
      finish();
      var error = new HTTPException(stalledMessage);
      stalled = error;
      // Cancelling the subscription closes the connection, so the blocked read ends. The wrapped
      // subscriber is failed by hand, as cancelling does not tell it; that also completes the
      // response, with the error.
      subscription.cancel();
      subscriber.onError(error);
    }
  }
}
