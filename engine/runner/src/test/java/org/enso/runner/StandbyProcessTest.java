package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeFalse;
import static org.junit.Assume.assumeTrue;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.stream.Stream;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * `enso --standby` as the project service runs it: the process's working directory is not the
 * project's parent, the line arrives on stdin, and the Language Server then answers `/_health` and
 * a JSON-RPC session, with the warm-up off, after a full warm-up in the same process, and with a
 * warm-up abandoned while it runs.
 *
 * <p>It runs the checkout's `built-distribution/` (`sbt buildEngineDistribution`) and is skipped
 * without one.
 */
public class StandbyProcessTest {
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private final List<Process> started = new ArrayList<>();

  /** A test that failed leaves its engine running: stop it, and the JVM under `cmd /c`. */
  @After
  public void stopEngines() {
    for (var process : started) {
      process.descendants().forEach(ProcessHandle::destroyForcibly);
      process.destroyForcibly();
    }
  }

  /** `built-distribution/enso-engine-*\/enso-*\/bin/enso(.bat)` above the working directory. */
  private static File launcher() throws IOException {
    var dir = Path.of("").toAbsolutePath();
    while (dir != null && !Files.exists(dir.resolve("build.sbt"))) {
      dir = dir.getParent();
    }
    if (dir == null || !Files.isDirectory(dir.resolve("built-distribution"))) {
      return null;
    }
    var name =
        System.getProperty("os.name").toLowerCase().contains("windows") ? "enso.bat" : "enso";
    try (Stream<Path> found = Files.walk(dir.resolve("built-distribution"), 4)) {
      return found
          .filter(p -> p.getFileName().toString().equals(name) && p.getParent().endsWith("bin"))
          .map(Path::toFile)
          .findFirst()
          .orElse(null);
    }
  }

  /** The launcher; the test is skipped without a built distribution. */
  private static File requireLauncher() throws IOException {
    var enso = launcher();
    assumeTrue("no built-distribution: build one with `sbt buildEngineDistribution`", enso != null);
    return enso;
  }

  /** The line's `LANGUAGE_SERVER_CHANNEL_TOKEN`. */
  private static final String CHANNEL_TOKEN = "standby-test";

  private static String json(String text) {
    return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private static int freePort() throws IOException {
    try (var socket = new ServerSocket(0)) {
      return socket.getLocalPort();
    }
  }

  private static boolean healthy(int port) {
    try {
      var connection =
          (HttpURLConnection)
              URI.create("http://127.0.0.1:" + port + "/_health").toURL().openConnection();
      connection.setConnectTimeout(500);
      connection.setReadTimeout(2000);
      return connection.getResponseCode() == 200;
    } catch (IOException e) {
      return false;
    }
  }

  /** The files and folders under {@code root}, relative to it, sorted. */
  private static List<String> tree(Path root) throws IOException {
    try (Stream<Path> paths = Files.walk(root)) {
      return paths
          .filter(p -> !p.equals(root))
          .map(p -> root.relativize(p).toString().replace('\\', '/'))
          .sorted()
          .toList();
    }
  }

  /**
   * A started standby engine, its stdout and stderr collected line by line.
   *
   * @param data its `ENSO_DATA_DIRECTORY`
   * @param dataBefore what {@code data} held before the process started
   * @param temporary its `java.io.tmpdir`, where the warm-up makes its project
   * @param readers the threads that collect {@code stdout} and {@code stderr}
   */
  private record Engine(
      Process process,
      List<String> stdout,
      List<String> stderr,
      Path data,
      List<String> dataBefore,
      Path temporary,
      List<Thread> readers) {
    boolean said(String text) {
      synchronized (stderr) {
        return stderr.stream().anyMatch(line -> line.contains(text));
      }
    }

    String lineWith(String text) {
      synchronized (stderr) {
        return stderr.stream().filter(line -> line.contains(text)).findFirst().orElse(null);
      }
    }

    /** The DEBUG, INFO or TRACE log lines on stdout so far. */
    List<String> chattyStdout() {
      synchronized (stdout) {
        return stdout.stream()
            .filter(line -> line.matches(".*\\b(TRACE|DEBUG|INFO)\\b.*"))
            .toList();
      }
    }

    /** The exit code, once the process has exited and all its output is collected. */
    int exitCode(long seconds) throws InterruptedException {
      assertTrue(
          "still running after " + seconds + " s: " + stderr,
          process.waitFor(seconds, TimeUnit.SECONDS));
      for (var reader : readers) {
        reader.join(TimeUnit.SECONDS.toMillis(10));
        assertFalse("output still open after the exit: " + reader.getName(), reader.isAlive());
      }
      return process.exitValue();
    }

    void waitFor(String text, long seconds) throws InterruptedException {
      var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
      while (!said(text)) {
        assertTrue(
            "no '" + text + "' within " + seconds + " s: " + stderr, System.nanoTime() < end);
        assertTrue("the engine exited: " + stderr, process.isAlive());
        Thread.sleep(50);
      }
    }

    void waitUntil(BooleanSupplier condition, String what, long seconds)
        throws InterruptedException {
      var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
      while (!condition.getAsBoolean()) {
        assertTrue("no " + what + " within " + seconds + " s: " + stderr, System.nanoTime() < end);
        assertTrue("the engine exited: " + stderr, process.isAlive());
        Thread.sleep(50);
      }
    }
  }

  /** A daemon thread that adds each line of {@code stream} to {@code lines}. */
  private static Thread collect(String name, InputStream stream, List<String> lines) {
    var reader =
        new Thread(
            () -> {
              try (var in =
                  new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = in.readLine()) != null) {
                  lines.add(line);
                }
              } catch (IOException e) {
                lines.add("read failed: " + e);
              }
            },
            name);
    reader.setDaemon(true);
    reader.start();
    return reader;
  }

  /**
   * Start `enso --standby` in a folder that is not the project's parent, with its own data
   * directory and temporary directory.
   */
  private Engine start(boolean warmUp, boolean abandon) throws IOException {
    return start(warmUp, abandon, Map.of());
  }

  /** {@link #start(boolean, boolean)} with {@code environment} added to the engine's. */
  private Engine start(boolean warmUp, boolean abandon, Map<String, String> environment)
      throws IOException {
    var enso = requireLauncher();
    var elsewhere = tmp.newFolder();
    var data = tmp.newFolder().toPath();
    var temporary = tmp.newFolder().toPath();
    var command = new ArrayList<String>();
    if (enso.getName().endsWith(".bat")) {
      command.addAll(List.of("cmd", "/c"));
    }
    command.addAll(
        List.of(
            enso.getAbsolutePath(),
            "--standby",
            "--vm.D",
            Standby.WARM_UP_PROPERTY + "=" + warmUp,
            "--vm.D",
            Standby.ABANDON_PROPERTY + "=" + abandon));
    var builder = new ProcessBuilder(command).directory(elsewhere);
    builder.environment().put("ENSO_DATA_DIRECTORY", data.toString());
    // The line carries these; inherited, they would make the engine refuse it.
    StandbyRequest.CONFIG_PROPERTIES.keySet().forEach(builder.environment()::remove);
    builder.environment().putAll(environment);
    // `java.io.tmpdir` is read at JVM start, so it cannot be a `--vm.D`.
    var toolOptions = builder.environment().get("JAVA_TOOL_OPTIONS");
    builder
        .environment()
        .put(
            "JAVA_TOOL_OPTIONS",
            (toolOptions == null || toolOptions.isBlank() ? "" : toolOptions + " ")
                + "-Djava.io.tmpdir="
                + temporary);
    var dataBefore = tree(data);
    var process = builder.start();
    started.add(process);
    var stdout = Collections.synchronizedList(new ArrayList<String>());
    var stderr = Collections.synchronizedList(new ArrayList<String>());
    var readers =
        List.of(
            collect("engine stdout", process.getInputStream(), stdout),
            collect("engine stderr", process.getErrorStream(), stderr));
    return new Engine(process, stdout, stderr, data, dataBefore, temporary, readers);
  }

  private Path project() throws IOException {
    var project = tmp.newFolder("projects", "Standby_Test").toPath();
    Files.writeString(
        project.resolve("package.yaml"),
        "name: Standby_Test\n"
            + "namespace: local\n"
            + "version: 0.0.1\n"
            + "license: ''\n"
            + "authors: []\n"
            + "maintainers: []\n");
    Files.createDirectories(project.resolve("src"));
    Files.writeString(project.resolve("src").resolve("Main.enso"), "main = 42\n");
    return project;
  }

  private static String line(Path project, int port, String rootId) {
    var args =
        List.of(
            "--server",
            "--root-id",
            rootId,
            "--project-id",
            UUID.randomUUID().toString(),
            "--path",
            project.toString(),
            "--interface",
            "127.0.0.1",
            "--rpc-port",
            Integer.toString(port));
    var quoted = args.stream().map(StandbyProcessTest::json).toList();
    return "{\"args\":["
        + String.join(",", quoted)
        + "],\"env\":{\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\""
        + CHANNEL_TOKEN
        + "\","
        + "\"ENSO_LOCAL_PROJECT_ID\":\"standby-test-key\"}}\n";
  }

  /**
   * `session/initProtocolConnection` on the JSON-RPC channel socket, as the GUI's first call; its
   * answer. The socket is the ydoc server's (`/channel/json`, Note [The Channel Socket] in
   * `YjsChannelEndpoint`), so an answer also shows that the line's channel token was applied.
   * `/_health` passes while the Language Server still initialises, and a socket opened then is
   * dropped (`jvmAot/driver.ts` in the shim), so a failed attempt is retried once a second.
   */
  private static String initProtocolConnection(int port) throws Exception {
    var client = HttpClient.newHttpClient();
    var end = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
    Exception last = null;
    while (System.nanoTime() < end) {
      var answer = new CompletableFuture<String>();
      var message = new StringBuilder();
      try {
        var socket =
            client
                .newWebSocketBuilder()
                .buildAsync(
                    URI.create("ws://127.0.0.1:" + port + "/channel/json?token=" + CHANNEL_TOKEN),
                    new WebSocket.Listener() {
                      @Override
                      public CompletionStage<?> onText(
                          WebSocket ws, CharSequence data, boolean lastPart) {
                        message.append(data);
                        if (lastPart) {
                          var text = message.toString();
                          message.setLength(0);
                          if (text.contains("\"id\":0")) {
                            answer.complete(text);
                          }
                        }
                        ws.request(1);
                        return null;
                      }

                      @Override
                      public void onError(WebSocket ws, Throwable error) {
                        answer.completeExceptionally(error);
                      }

                      @Override
                      public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
                        answer.completeExceptionally(new IOException("closed: " + code));
                        return null;
                      }
                    })
                .get(10, TimeUnit.SECONDS);
        socket.sendText(
            "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"session/initProtocolConnection\","
                + "\"params\":{\"clientId\":\""
                + UUID.randomUUID()
                + "\"}}",
            true);
        var reply = answer.get(30, TimeUnit.SECONDS);
        socket.sendClose(WebSocket.NORMAL_CLOSURE, "done");
        return reply;
      } catch (Exception e) {
        last = e;
        Thread.sleep(1000);
      }
    }
    throw new AssertionError("no answer to session/initProtocolConnection", last);
  }

  /**
   * Hand `engine` the line for a fresh project, and check that its Language Server answers
   * `/_health`, opens the project (the content roots name the line's root id) and stops on a
   * newline.
   */
  private void serveProject(Engine engine) throws Exception {
    serveProject(engine, () -> {});
  }

  /** {@link #serveProject(Engine)}, running {@code beforeLine} just before the line is written. */
  private void serveProject(Engine engine, Runnable beforeLine) throws Exception {
    var project = project();
    var port = freePort();
    var rootId = UUID.randomUUID().toString();
    var stdin = engine.process().getOutputStream();
    beforeLine.run();
    stdin.write(line(project, port, rootId).getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    engine.waitUntil(() -> healthy(port), "/_health", 120);
    var reply = initProtocolConnection(port);
    assertTrue(reply, reply.contains("\"result\""));
    assertTrue("the project is a content root: " + reply, reply.contains(rootId));
    assertFalse(engine.stderr().toString(), engine.said("unexpected working directory"));
    stdin.write('\n');
    stdin.flush();
    assertEquals(engine.stderr().toString(), 0, engine.exitCode(60));
    // All of stdout is read now. The warm-up's thread ends before the Language Server starts, so
    // any log line of it came before the line.
    assertEquals(
        "the warm-up's log lines",
        List.of(),
        engine.chattyStdout().stream()
            .filter(line -> line.contains("[" + Standby.WARM_UP_THREAD + "]"))
            .toList());
  }

  /** The warm-up's temporary project folders (`enso-standby-*`) that are still there. */
  private static List<String> warmUpFolders(Engine engine) throws IOException {
    return tree(engine.temporary()).stream().filter(p -> p.startsWith("enso-standby-")).toList();
  }

  /** The new paths in the data directory that are not library IR caches or their locks. */
  private static List<String> notLibraryCaches(Engine engine) throws IOException {
    var written = new ArrayList<>(tree(engine.data()));
    written.removeAll(engine.dataBefore());
    // The folders above the caches; `local` is where the warm-up's project cache was.
    var parents = List.of("cache", "cache/ir", "cache/ir/local", "cache/ir/Standard", "lock");
    return written.stream()
        .filter(
            p ->
                !parents.contains(p)
                    && !p.startsWith("cache/ir/Standard/")
                    && !p.startsWith("lock/cached-library-"))
        .toList();
  }

  /** What is left of the warm-up's project IR cache in the data directory. */
  private static List<String> warmUpCache(Engine engine) throws IOException {
    return tree(engine.data()).stream()
        .filter(p -> p.startsWith("cache/ir/local/" + StandbyWarmUp.PROJECT_NAME))
        .toList();
  }

  @Test(timeout = 300_000)
  public void theLineStartsALanguageServer() throws Exception {
    var engine = start(false, false);
    engine.waitFor(Standby.READY, 120);
    assertEquals(List.of(), engine.chattyStdout());
    serveProject(engine);
  }

  @Test(timeout = 480_000)
  public void aWarmedUpStandbyOpensTheProject() throws Exception {
    var engine = start(true, false);
    engine.waitFor(Standby.READY, 240);
    assertEquals("log lines before READY", List.of(), engine.chattyStdout());
    var done = engine.lineWith("standby: warm-up done in ");
    assertTrue(engine.stderr().toString(), done != null && done.contains(", preloaded "));
    assertTrue(engine.stderr().toString(), engine.said(StandbyWarmUp.RUNNING));
    assertTrue(engine.stderr().toString(), engine.said(StandbyWarmUp.FINISHED));
    assertFalse(engine.stderr().toString(), engine.said("warm-up failed"));
    assertFalse(engine.stderr().toString(), engine.said("warm-up abandoned"));
    assertEquals("the warm-up's project is deleted", List.of(), warmUpFolders(engine));
    assertEquals("the warm-up wrote only library caches", List.of(), notLibraryCaches(engine));
    // The same process: the warm-up's context is gone, and the project's opens as usual.
    serveProject(engine);
  }

  @Test(timeout = 480_000)
  public void aLineDuringTheWarmUpAbandonsIt() throws Exception {
    var engine = start(true, true);
    // The warm-up's context runs Enso code: compiling and running its `main` takes seconds yet.
    engine.waitFor(StandbyWarmUp.RUNNING, 240);
    assertEquals("log lines before the line", List.of(), engine.chattyStdout());
    var finishedBeforeTheLine = new AtomicBoolean();
    serveProject(engine, () -> finishedBeforeTheLine.set(engine.said(StandbyWarmUp.FINISHED)));
    var done = engine.lineWith("standby: warm-up done in ");
    assertTrue(engine.stderr().toString(), done != null);
    assertFalse(engine.stderr().toString(), engine.said("warm-up failed"));
    assertEquals("the warm-up's project is deleted", List.of(), warmUpFolders(engine));
    // The Language Server writes its logs there by now: only the warm-up's cache is looked for.
    assertEquals("the warm-up's IR cache is deleted", List.of(), warmUpCache(engine));
    // `main` takes seconds after RUNNING, but a slow machine may have finished it before the line
    // was written: then the abandon path cannot run, and only that skips the test. A `main` that
    // finishes after the line (the cancel did not stop it, or the abandon was ignored) fails it.
    assumeFalse(
        "the warm-up finished before the line was written: " + engine.stderr(),
        finishedBeforeTheLine.get());
    assertTrue(engine.stderr().toString(), done.contains("preloading abandoned"));
    assertTrue(engine.stderr().toString(), engine.said("standby: warm-up abandoned"));
    assertFalse(engine.stderr().toString(), engine.said(StandbyWarmUp.FINISHED));
  }

  @Test(timeout = 300_000)
  public void stdinClosedBeforeTheLineExitsWithZero() throws Exception {
    var engine = start(false, false);
    engine.process().getOutputStream().close();
    assertEquals(engine.stderr().toString(), 0, engine.exitCode(120));
  }

  /**
   * Start an engine, hand it {@code args} (a JSON array) and expect exit 1 with {@code message}.
   */
  private void refused(String args, String message) throws Exception {
    var engine = start(false, false);
    var stdin = engine.process().getOutputStream();
    stdin.write(("{\"args\":" + args + "}\n").getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    assertEquals(engine.stderr().toString(), 1, engine.exitCode(120));
    assertTrue(engine.stderr().toString(), engine.said(message));
  }

  @Test(timeout = 300_000)
  public void aRelativePathIsRefused() throws Exception {
    refused(
        "[\"--server\",\"--path\",\"Relative_Project\",\"--rpc-port\",\"1\"]",
        "needs an absolute --path");
  }

  @Test(timeout = 300_000)
  public void aFilesystemRootIsRefused() throws Exception {
    var root = tmp.getRoot().toPath().toAbsolutePath().getRoot().toString();
    refused(
        "[\"--server\",\"--path\"," + json(root) + ",\"--rpc-port\",\"1\"]",
        "--path cannot be a filesystem root");
  }

  @Test(timeout = 300_000)
  public void aLineThatIsNotALanguageServerIsRefused() throws Exception {
    var project = json(project().toString());
    refused("[\"--run\"," + project + "]", "must start a Language Server");
    refused(
        "[\"--server\",\"--standby\",\"--path\"," + project + ",\"--rpc-port\",\"1\"]",
        "must start a Language Server");
  }

  @Test(timeout = 300_000)
  public void anInheritedChannelTokenIsRefused() throws Exception {
    var inherited = "inherited-token-518";
    var engine = start(false, false, Map.of("LANGUAGE_SERVER_CHANNEL_TOKEN", inherited));
    var stdin = engine.process().getOutputStream();
    stdin.write(
        line(project(), freePort(), UUID.randomUUID().toString()).getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    assertEquals(engine.stderr().toString(), 1, engine.exitCode(120));
    assertTrue(
        engine.stderr().toString(),
        engine.said("standby: LANGUAGE_SERVER_CHANNEL_TOKEN is set in the standby engine's"));
    assertFalse("the value is not echoed", engine.said(inherited));
  }
}
