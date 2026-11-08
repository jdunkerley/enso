package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
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
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
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
   * A started standby engine, its stderr collected line by line.
   *
   * @param data its `ENSO_DATA_DIRECTORY`
   * @param temporary its `java.io.tmpdir`, where the warm-up makes its project
   */
  private record Engine(Process process, List<String> stderr, Path data, Path temporary) {
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

    void waitFor(String text, long seconds) throws InterruptedException {
      waitUntil(() -> said(text), "'" + text + "'", seconds);
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

  /**
   * Start `enso --standby` in a folder that is not the project's parent, with its own data
   * directory and temporary directory.
   */
  private Engine start(boolean warmUp, boolean abandon) throws IOException {
    var enso = requireLauncher();
    var elsewhere = tmp.newFolder("elsewhere");
    var data = tmp.newFolder("data").toPath();
    var temporary = tmp.newFolder("temporary").toPath();
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
    // `java.io.tmpdir` is read at JVM start, so it cannot be a `--vm.D`.
    builder.environment().put("JAVA_TOOL_OPTIONS", "-Djava.io.tmpdir=" + temporary);
    builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
    var process = builder.start();
    started.add(process);
    var stderr = Collections.synchronizedList(new ArrayList<String>());
    var reader =
        new Thread(
            () -> {
              try (var lines =
                  new BufferedReader(
                      new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = lines.readLine()) != null) {
                  stderr.add(line);
                }
              } catch (IOException e) {
                stderr.add("read failed: " + e);
              }
            });
    reader.setDaemon(true);
    reader.start();
    return new Engine(process, stderr, data, temporary);
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
        + "],\"env\":{\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"standby-test\","
        + "\"ENSO_LOCAL_PROJECT_ID\":\"standby-test-key\"}}\n";
  }

  /**
   * `session/initProtocolConnection` on the JSON-RPC socket, as the GUI's first call; its answer.
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
                    URI.create("ws://127.0.0.1:" + port + "/"),
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
    var project = project();
    var port = freePort();
    var rootId = UUID.randomUUID().toString();
    var stdin = engine.process().getOutputStream();
    stdin.write(line(project, port, rootId).getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    engine.waitUntil(() -> healthy(port), "/_health", 120);
    var reply = initProtocolConnection(port);
    assertTrue(reply, reply.contains("\"result\""));
    assertTrue("the project is a content root: " + reply, reply.contains(rootId));
    assertFalse(engine.stderr().toString(), engine.said("unexpected working directory"));
    stdin.write('\n');
    stdin.flush();
    assertTrue(engine.process().waitFor(60, TimeUnit.SECONDS));
    assertEquals(0, engine.process().exitValue());
  }

  /** The warm-up's temporary project folders (`enso-standby-*`) that are still there. */
  private static List<String> warmUpFolders(Engine engine) throws IOException {
    return tree(engine.temporary()).stream().filter(p -> p.startsWith("enso-standby-")).toList();
  }

  @Test(timeout = 300_000)
  public void theLineStartsALanguageServer() throws Exception {
    var engine = start(false, false);
    engine.waitFor(Standby.READY, 120);
    System.out.println("data directory at READY, no warm-up: " + tree(engine.data()));
    serveProject(engine);
  }

  @Test(timeout = 480_000)
  public void aWarmedUpStandbyOpensTheProject() throws Exception {
    var engine = start(true, false);
    var before = tree(engine.data());
    engine.waitFor(Standby.READY, 240);
    var done = engine.lineWith("standby: warm-up done in ");
    assertTrue(engine.stderr().toString(), done != null && done.contains(", preloaded "));
    assertFalse(engine.stderr().toString(), engine.said("warm-up failed"));
    assertFalse(engine.stderr().toString(), engine.said("warm-up abandoned"));
    assertEquals("the warm-up's project is deleted", List.of(), warmUpFolders(engine));
    var after = new ArrayList<>(tree(engine.data()));
    after.removeAll(before);
    System.out.println("data directory written before READY by the warm-up: " + after);
    // The same process: the warm-up's context is gone, and the project's opens as usual.
    serveProject(engine);
  }

  @Test(timeout = 480_000)
  public void aLineDuringTheWarmUpAbandonsIt() throws Exception {
    var engine = start(true, true);
    // The warm-up has written its `Main` and is about to compile and run it.
    engine.waitUntil(
        () -> {
          try (Stream<Path> found = Files.walk(engine.temporary(), 4)) {
            return found.anyMatch(
                p -> {
                  try {
                    return p.endsWith(Path.of(StandbyWarmUp.PROJECT_NAME, "src", "Main.enso"))
                        && Files.readString(p).equals(StandbyWarmUp.MAIN_SOURCE);
                  } catch (IOException e) {
                    return false;
                  }
                });
          } catch (IOException e) {
            return false;
          }
        },
        "warm-up project",
        120);
    serveProject(engine);
    var done = engine.lineWith("standby: warm-up done in ");
    assertTrue(engine.stderr().toString(), done != null && done.contains("preloading abandoned"));
    assertTrue(engine.stderr().toString(), engine.said("standby: warm-up abandoned"));
    assertFalse(engine.stderr().toString(), engine.said("warm-up failed"));
    assertEquals("the warm-up's project is deleted", List.of(), warmUpFolders(engine));
  }

  @Test(timeout = 300_000)
  public void stdinClosedBeforeTheLineExitsWithZero() throws Exception {
    var engine = start(false, false);
    engine.process().getOutputStream().close();
    assertTrue(engine.process().waitFor(120, TimeUnit.SECONDS));
    assertEquals(engine.stderr().toString(), 0, engine.process().exitValue());
  }

  @Test(timeout = 300_000)
  public void aRelativePathIsRefused() throws Exception {
    var engine = start(false, false);
    var stdin = engine.process().getOutputStream();
    stdin.write(
        "{\"args\":[\"--server\",\"--path\",\"Relative_Project\",\"--rpc-port\",\"1\"]}\n"
            .getBytes(StandardCharsets.UTF_8));
    stdin.flush();
    assertTrue(engine.process().waitFor(120, TimeUnit.SECONDS));
    assertEquals(1, engine.process().exitValue());
    assertTrue(engine.stderr().toString(), engine.said("needs an absolute --path"));
  }
}
