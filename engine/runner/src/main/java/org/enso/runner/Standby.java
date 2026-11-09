package org.enso.runner;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/* Note [Standby Mode]
 * ~~~~~~~~~~~~~~~~~~~
 * `enso --jvm --standby` is the IDE's spare engine (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). The project service starts it while
 * the user is on the dashboard, before any project is known. On a background thread it warms up
 * (`StandbyWarmUp`: a throwaway context runs the default template's imports on a temporary project)
 * and preloads classes (`StandbyPreloader`), then prints `standby: warm-up done in N ms, …` and
 * `STANDBY READY <ms from process start>` on stderr. Meanwhile the main thread reads one line from
 * stdin: `{"args":[...],"env":{...}}` (`StandbyRequest`), the arguments `project/open` would have
 * passed and the open's own variables. It cancels a warm-up still running (unless
 * `enso.standby.abandonWarmUp` is false, which waits for it: abandoning is the default since
 * #659, as waiting made an open slower than a cold start; a warm-up still running 60 s after the
 * line is cancelled even then, and a bad line or stdin closing first cancels it before the process
 * exits), then hands the line to `Main`, which applies the variables, sets the context's working
 * directory to the parent of `--path` (`ContextFactory.WORKING_DIRECTORY_PROPERTY`; relative paths
 * and a filesystem root are refused, and so is a line that does not start a Language Server or
 * carries `--standby`, `--jvm`, `--in-project` or `--run`), and calls `Main.launch` with the
 * arguments: from then on the process is an ordinary Language Server, which shuts down on the next
 * stdin line as always. If stdin closes before a line arrives, the process exits with 0 once the
 * warm-up has stopped and deleted its files.
 *
 * Two things a normal engine gets from its spawn arrive late here, and both are handed over without
 * changing the Language Server's boot:
 *
 * - The working directory. The process was started before the project was known, so its own working
 *   directory is not the project's parent. The context's is (the property above), and the runtime
 *   resolves relative file paths and starts processes against the context's working directory, not
 *   the process's (`System.java` and `File_Helpers.enso` in the standard library). In a normal
 *   engine the two are the same.
 * - The per-open variables (the channel token, the ydoc port, the project and session ids). A JVM
 *   cannot change its own environment, so `StandbyRequest.applyEnvironment` sets each as the system
 *   property it is also read through: the configuration's own property for the Language Server's
 *   settings, `enso.env.<NAME>` for those read through `ProcessEnvironment`.
 *
 * Nothing sets up logging before the line: the Language Server does that itself, and its session log
 * must be the project's. Until then the root logger's level is WARN (`quietLogging`), so that the
 * logging backend's default does not print the warm-up's DEBUG events on stdout. Before the line
 * the engine writes these stderr lines (and `standby: warm-up running` once the warm-up's context
 * runs Enso code, `standby: warm-up finished` once its `main` has returned), which the shim echoes
 * and summarises in the opened project's engine log. A warm-up that throws is reported there as
 * `standby: warning: warm-up failed: …` and the engine still reaches standby.
 *
 * Only the process carries over from the warm-up: HotSpot's compiled code, loaded classes and the
 * IR caches it read. The warm-up's context is closed before the Language Server's is created.
 */
/** The standby mode's wait: warm up in the background, read the argument line. */
final class Standby {
  /** The stderr line the project service waits for. */
  static final String READY = "STANDBY READY";

  /** The thread the warm-up and the preloading run on. */
  static final String WARM_UP_THREAD = "enso-standby-warm-up";

  /** {@code false} skips the warm-up (tests that only need the Language Server). */
  static final String WARM_UP_PROPERTY = "enso.standby.warmUp";

  /** {@code true} abandons a running warm-up as soon as the line arrives. */
  static final String ABANDON_PROPERTY = "enso.standby.abandonWarmUp";

  /** The warm-up: run on the background thread; cancelled from the reading thread. */
  interface WarmUp {
    void run() throws Exception;

    void cancel();
  }

  /** The preloading, after the warm-up; its result is a phrase for the log line. */
  interface Preload {
    String run(BooleanSupplier abandoned);
  }

  static final WarmUp NO_WARM_UP =
      new WarmUp() {
        @Override
        public void run() {}

        @Override
        public void cancel() {}
      };

  private final WarmUp warmUp;
  private final Preload preload;
  private final PrintStream err;
  private final boolean abandonOnLine;
  private final Duration lineWait;
  private final Duration closeWait;
  private volatile boolean abandoned;

  /** How long a warm-up may still run once the line has arrived, before it is abandoned. */
  static final Duration LINE_WAIT = Duration.ofSeconds(60);

  /**
   * How long a warm-up cancelled because stdin closed before the line may take to stop, before the
   * process exits regardless: the IDE that closed it may be quitting, and must not leave a JVM
   * behind.
   */
  static final Duration CLOSE_WAIT = Duration.ofSeconds(10);

  Standby(WarmUp warmUp, Preload preload, PrintStream err, boolean abandonOnLine) {
    this(warmUp, preload, err, abandonOnLine, LINE_WAIT);
  }

  Standby(
      WarmUp warmUp, Preload preload, PrintStream err, boolean abandonOnLine, Duration lineWait) {
    this(warmUp, preload, err, abandonOnLine, lineWait, CLOSE_WAIT);
  }

  Standby(
      WarmUp warmUp,
      Preload preload,
      PrintStream err,
      boolean abandonOnLine,
      Duration lineWait,
      Duration closeWait) {
    this.warmUp = warmUp;
    this.preload = preload;
    this.err = err;
    this.abandonOnLine = abandonOnLine;
    this.lineWait = lineWait;
    this.closeWait = closeWait;
  }

  /** The standby of `enso --standby`: the real warm-up and preloader, and the two properties. */
  static Standby create(File component) {
    WarmUp warmUp = NO_WARM_UP;
    if (Boolean.parseBoolean(System.getProperty(WARM_UP_PROPERTY, "true"))) {
      try {
        warmUp = new StandbyWarmUp();
      } catch (RuntimeException | LinkageError e) {
        System.err.println("standby: warning: no warm-up, its setup failed: " + e);
      }
    }
    return new Standby(
        warmUp,
        preloadFor(component, System.getenv(JvmOptions.ENVIRONMENT_VARIABLE), System.err),
        System.err,
        Boolean.parseBoolean(System.getProperty(ABANDON_PROPERTY, "true")));
  }

  /**
   * The preloading for the JVM options of {@code component}'s `jvm.options` and {@code
   * environmentValue}. Options that cannot be read are no reason to stop a standby engine: it
   * preloads nothing then, and says why.
   */
  static Preload preloadFor(File component, String environmentValue, PrintStream err) {
    List<String> jvmOptions;
    try {
      jvmOptions = JvmOptions.all(component, environmentValue);
    } catch (RuntimeException e) {
      err.println("standby: warning: cannot read the JVM options, no preloading: " + e);
      return abandoned -> "preloading skipped: the JVM options could not be read";
    }
    return new StandbyPreloader(jvmOptions)::preload;
  }

  /**
   * Raise the logging threshold to WARN until the argument line has been taken. Nothing sets up
   * logging before the line (the Language Server does that itself, Note [Standby Mode]), and the
   * backend's default (logback without a configuration) prints every DEBUG event of the warm-up on
   * stdout. Only the root logger's level changes; no appender is installed. Logback is not a module
   * the runner reads, so its API is called reflectively; with another backend nothing changes.
   *
   * @return puts the previous level back
   */
  static Runnable quietLogging(PrintStream err) {
    var root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    try {
      var loader = root.getClass().getClassLoader();
      var levelClass = Class.forName("ch.qos.logback.classic.Level", true, loader);
      var getLevel = root.getClass().getMethod("getLevel");
      var setLevel = root.getClass().getMethod("setLevel", levelClass);
      var previous = getLevel.invoke(root);
      setLevel.invoke(root, levelClass.getField("WARN").get(null));
      return () -> {
        try {
          setLevel.invoke(root, previous);
        } catch (ReflectiveOperationException e) {
          err.println("standby: warning: could not restore the log level: " + e);
        }
      };
    } catch (ReflectiveOperationException | LinkageError e) {
      return () -> {};
    }
  }

  /**
   * Start the warm-up, and read the argument line.
   *
   * @return the request, once the warm-up is over; {@code null} when stdin closed first (the
   *     warm-up is then cancelled, and over, or still stopping after {@link #CLOSE_WAIT})
   * @throws IllegalArgumentException when the line is not a valid request
   */
  StandbyRequest awaitRequest(InputStream in) throws IOException, InterruptedException {
    var finished = new CountDownLatch(1);
    var thread =
        new Thread(
            () -> {
              try {
                prepare();
              } finally {
                finished.countDown();
              }
            },
            WARM_UP_THREAD);
    thread.setDaemon(true);
    thread.start();
    var line = readLine(in);
    if (line == null) {
      // The process exits with 0 next: stop the warm-up first, so that its folder and IR cache are
      // deleted. A warm-up that does not stop in time is left to the exit, which loses its cleanup:
      // the IDE closes stdin when it quits, and a JVM must not outlive it.
      abandon();
      if (!finished.await(closeWait.toMillis(), TimeUnit.MILLISECONDS)) {
        err.println(
            "standby: warning: the cancelled warm-up did not stop within "
                + describe(closeWait)
                + "; exiting without it");
      }
      return null;
    }
    StandbyRequest request;
    try {
      request = StandbyRequest.parse(line);
    } catch (IllegalArgumentException e) {
      // The process exits on a bad line: stop the warm-up first, so that its folder is deleted.
      abandon();
      finished.await();
      throw e;
    }
    if (abandonOnLine) {
      abandon();
    }
    // A warm-up that hangs must not hold the open for good.
    if (!finished.await(lineWait.toMillis(), TimeUnit.MILLISECONDS)) {
      err.println("standby: warm-up abandoned after " + describe(lineWait));
      abandon();
      finished.await();
    }
    return request;
  }

  /** {@code 60 s}, or {@code 200 ms} when not whole seconds. */
  private static String describe(Duration duration) {
    var ms = duration.toMillis();
    return ms % 1000 == 0 ? ms / 1000 + " s" : ms + " ms";
  }

  private void abandon() {
    abandoned = true;
    warmUp.cancel();
  }

  private void prepare() {
    var started = System.nanoTime();
    try {
      warmUp.run();
    } catch (Throwable t) {
      if (abandoned) {
        err.println("standby: warm-up abandoned");
      } else {
        err.println("standby: warning: warm-up failed: " + t);
      }
    }
    String preloaded;
    try {
      preloaded = abandoned ? "preloading abandoned" : preload.run(() -> abandoned);
    } catch (Throwable t) {
      preloaded = "preloading failed: " + t;
    }
    var ms = (System.nanoTime() - started) / 1_000_000;
    var cpu = ProcessHandle.current().info().totalCpuDuration().map(Duration::toMillis).orElse(-1L);
    err.println(
        "standby: warm-up done in " + ms + " ms, " + preloaded + ", process CPU " + cpu + " ms");
    err.println(READY + " " + sinceProcessStart());
    err.flush();
  }

  /** Milliseconds since this process started (the `enso` launcher, which hosts the JVM). */
  static long sinceProcessStart() {
    return ProcessHandle.current()
        .info()
        .startInstant()
        .map(start -> Duration.between(start, Instant.now()).toMillis())
        .orElse(-1L);
  }

  /**
   * One line, read a byte at a time so that nothing after it is consumed: the Language Server reads
   * its shutdown line from the same stdin later.
   *
   * @return the line without its line break, or {@code null} when the stream ends first
   */
  static String readLine(InputStream in) throws IOException {
    var bytes = new ByteArrayOutputStream();
    while (true) {
      int b = in.read();
      if (b < 0) {
        return null;
      }
      if (b == '\n') {
        var line = bytes.toString(StandardCharsets.UTF_8);
        return line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
      }
      bytes.write(b);
    }
  }
}
