package org.enso.ydoc.polyfill.web;

import java.io.IOException;
import java.net.ServerSocket;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * A semaphore whose {@link #acquire} gives up after {@link #TIMEOUT_SECONDS}, so a handler that
 * never ran fails the test instead of hanging it (#409). Both the test and the JS code under test
 * call it.
 */
public final class TimedLock {

  static final long TIMEOUT_SECONDS = 10;

  private final Semaphore semaphore = new Semaphore(0);

  public void release() {
    semaphore.release();
  }

  public void acquire(int permits) throws InterruptedException {
    if (!semaphore.tryAcquire(permits, TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      throw new AssertionError(
          "Timed out after " + TIMEOUT_SECONDS + " s waiting for " + permits + " permit(s)");
    }
  }

  /** A port that was free a moment ago; chosen at run time so test runs do not collide. */
  static int freePort() throws IOException {
    try (var socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }
}
