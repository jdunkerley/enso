package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class StandbyTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private static final String LINE = "{\"args\":[\"--server\"]}\n";

  private final ByteArrayOutputStream errBytes = new ByteArrayOutputStream();
  private final PrintStream err = new PrintStream(errBytes, true, StandardCharsets.UTF_8);

  private String err() {
    return errBytes.toString(StandardCharsets.UTF_8);
  }

  private static ByteArrayInputStream in(String text) {
    return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
  }

  /** A warm-up that runs until released, and records a cancel. */
  private static final class Gate implements Standby.WarmUp {
    final CountDownLatch release = new CountDownLatch(1);
    final AtomicBoolean cancelled = new AtomicBoolean();

    @Override
    public void run() throws Exception {
      release.await();
      if (cancelled.get()) {
        throw new IllegalStateException("cancelled");
      }
    }

    @Override
    public void cancel() {
      cancelled.set(true);
      release.countDown();
    }
  }

  /** A stream that counts {@link #lineRead} down once it has handed out a newline. */
  private static final class Watched extends FilterInputStream {
    final CountDownLatch lineRead = new CountDownLatch(1);

    Watched(InputStream in) {
      super(in);
    }

    @Override
    public int read() throws IOException {
      int b = super.read();
      if (b == '\n') {
        lineRead.countDown();
      }
      return b;
    }
  }

  /** Waits, up to 10 s, until {@code thread} is parked (the wait for the warm-up has a limit). */
  private static void awaitParked(Thread thread) throws InterruptedException {
    var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (thread.getState() != Thread.State.WAITING
        && thread.getState() != Thread.State.TIMED_WAITING) {
      assertTrue("the reading thread never started waiting", System.nanoTime() < deadline);
      Thread.onSpinWait();
      Thread.yield();
    }
  }

  @Test
  public void readsOneLineAndLeavesTheRest() throws Exception {
    var stream = in("first\nsecond\n");
    assertEquals("first", Standby.readLine(stream));
    assertEquals("second\n", new String(stream.readAllBytes(), StandardCharsets.UTF_8));
  }

  @Test
  public void aClosedStdinBeforeANewlineIsNoLine() throws Exception {
    assertNull(Standby.readLine(in("")));
    assertNull(Standby.readLine(in("partial")));
  }

  @Test
  public void theLineWaitsForTheWarmUp() throws Exception {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "preloaded 0 of 0 classes", err, false);
    var stdin = new Watched(in(LINE));
    var reader = new CompletableFuture<Thread>();
    var executor = Executors.newSingleThreadExecutor();
    try {
      var result =
          executor.submit(
              () -> {
                reader.complete(Thread.currentThread());
                return standby.awaitRequest(stdin);
              });
      assertTrue(stdin.lineRead.await(10, TimeUnit.SECONDS));
      // The line is in and parsed once the reader parks: it can only be parked on the warm-up.
      awaitParked(reader.get(10, TimeUnit.SECONDS));
      assertFalse("the request waits for the warm-up", result.isDone());
      gate.release.countDown();
      assertEquals(List.of("--server"), result.get(10, TimeUnit.SECONDS).args());
      assertFalse(gate.cancelled.get());
      assertTrue(err(), err().contains("standby: warm-up done in "));
      assertTrue(err(), err().contains(Standby.READY + " "));
    } finally {
      executor.shutdownNow();
    }
  }

  @Test
  public void abandoningCancelsTheWarmUp() throws Exception {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "never asked", err, true);
    var request = standby.awaitRequest(in(LINE));
    assertEquals(List.of("--server"), request.args());
    assertTrue(gate.cancelled.get());
    assertTrue(err(), err().contains("standby: warm-up abandoned"));
    assertTrue(err(), err().contains("preloading abandoned"));
  }

  @Test
  public void aFailingWarmUpStillReachesStandby() throws Exception {
    Standby.WarmUp failing =
        new Standby.WarmUp() {
          @Override
          public void run() {
            throw new IllegalStateException("no libraries");
          }

          @Override
          public void cancel() {}
        };
    var standby = new Standby(failing, abandoned -> "preloaded 0 of 0 classes", err, false);
    assertEquals(List.of("--server"), standby.awaitRequest(in(LINE)).args());
    assertTrue(err(), err().contains("standby: warning: warm-up failed: "));
    assertTrue(err(), err().contains("no libraries"));
    assertTrue(err(), err().contains(Standby.READY + " "));
  }

  @Test
  public void stdinClosedFirstGivesNoRequest() throws Exception {
    var standby = new Standby(Standby.NO_WARM_UP, abandoned -> "x", err, false);
    assertNull(standby.awaitRequest(in("")));
  }

  @Test(timeout = 30_000)
  public void aWarmUpStillRunningAfterTheWaitIsAbandoned() throws Exception {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "x", err, false, Duration.ofMillis(200));
    assertNotNull(standby.awaitRequest(in(LINE)));
    assertTrue("cancelled", gate.cancelled.get());
    assertTrue(err(), err().contains("standby: warm-up abandoned after 200 ms"));
    assertTrue(err(), err().contains(", preloading abandoned, "));
  }

  @Test(timeout = 30_000)
  public void aBadLineStopsTheRunningWarmUpBeforeItIsRefused() {
    var gate = new Gate();
    var standby = new Standby(gate, abandoned -> "x", err, false);
    assertThrows(IllegalArgumentException.class, () -> standby.awaitRequest(in("[1]\n")));
    assertTrue("cancelled", gate.cancelled.get());
    // The warm-up's thread had ended: it prints this line last.
    assertTrue(err(), err().contains(Standby.READY));
  }

  @Test
  public void aBadLineIsRefused() {
    var standby = new Standby(Standby.NO_WARM_UP, abandoned -> "x", err, false);
    assertThrows(IllegalArgumentException.class, () -> standby.awaitRequest(in("[1]\n")));
  }

  @Test
  public void unreadableJvmOptionsMeanNoPreloading() throws Exception {
    var component = tmp.newFolder("component");
    // Not UTF-8: `JvmOptions.fromFile` cannot read it.
    Files.write(
        tmp.getRoot().toPath().resolve(JvmOptions.FILE_NAME),
        new byte[] {(byte) 0xC3, (byte) 0x28});
    var preload = Standby.preloadFor(component, null, err);
    assertEquals("preloading skipped: the JVM options could not be read", preload.run(() -> false));
    assertTrue(err(), err().contains("standby: warning: cannot read the JVM options"));
  }
}
