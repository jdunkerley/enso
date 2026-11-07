package org.enso.downloader.http;

import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.instanceOf;
import static org.hamcrest.CoreMatchers.not;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.junit.Assert.assertTrue;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpConnectTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.enso.cli.task.TaskProgress;
import org.junit.After;
import org.junit.AfterClass;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import scala.Option;

/**
 * A server that accepts a connection and never answers must not hang a download (#600): the library
 * resolution waiting on it blocked the project's first execution, so the IDE said "Initializing the
 * project" for good and never said why.
 */
public class HttpDownloadTimeoutTest {

  private static ServerSocket silentServer;
  private static HttpServer answeringServer;
  private static ExecutorService answeringExecutor;

  /** `/fast` answers only once this is released: after `/slow`'s timeout has been seen. */
  private static volatile CountDownLatch fastMayAnswer = new CountDownLatch(0);

  private static final List<Socket> acceptedSockets = new CopyOnWriteArrayList<>();

  @BeforeClass
  public static void startSilentServer() throws IOException {
    silentServer = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    var acceptor =
        new Thread(
            () -> {
              while (!silentServer.isClosed()) {
                try {
                  // Read nothing and write nothing: the request waits for an answer.
                  acceptedSockets.add(silentServer.accept());
                } catch (IOException e) {
                  return;
                }
              }
            },
            "silent-http-server");
    acceptor.setDaemon(true);
    acceptor.start();

    // `/slow` answers too late for a short timeout; `/fast` answers when the test lets it.
    answeringServer =
        HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    answeringExecutor =
        Executors.newCachedThreadPool(
            runnable -> {
              var thread = new Thread(runnable, "answering-http-server");
              thread.setDaemon(true);
              return thread;
            });
    answeringServer.setExecutor(answeringExecutor);
    answeringServer.createContext("/slow", exchange -> answerAfter(exchange, 10_000));
    answeringServer.createContext(
        "/fast",
        exchange -> {
          try {
            fastMayAnswer.await(20, TimeUnit.SECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
          answerAfter(exchange, 0);
        });
    answeringServer.start();
  }

  private static void answerAfter(com.sun.net.httpserver.HttpExchange exchange, long millis)
      throws IOException {
    try {
      Thread.sleep(millis);
      var body = "ok".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
    } catch (InterruptedException | IOException e) {
      // The client gave up: nothing to answer.
    } finally {
      exchange.close();
    }
  }

  @AfterClass
  public static void stopSilentServer() throws IOException {
    answeringServer.stop(0);
    answeringExecutor.shutdownNow();
    silentServer.close();
    for (var socket : acceptedSockets) {
      socket.close();
    }
  }

  @Before
  public void forgetUnresponsiveServers() {
    HTTPDownload$.MODULE$.forgetUnresponsiveServers();
  }

  @After
  public void restoreUnresponsiveServerMemory() {
    HTTPDownload$.MODULE$.unresponsiveServerMemory_$eq(HTTPDownload.UnresponsiveServerMemory());
  }

  private static scala.util.Try<APIResponse> fetch(URI uri, Duration timeout) {
    return TaskProgress.waitForTask(
        HTTPDownload.fetchString(
            HTTPRequestBuilder.fromURI(uri).withResponseTimeout(timeout).GET(),
            Option.empty(),
            StandardCharsets.UTF_8));
  }

  private static URI answeringUri(String path) {
    return URI.create("http://127.0.0.1:" + answeringServer.getAddress().getPort() + path);
  }

  private static URI silentUri(String path) {
    return URI.create("http://127.0.0.1:" + silentServer.getLocalPort() + path);
  }

  @Test
  public void aGetRequestWaitsForAnAnswerOnlySoLong() {
    var request = HTTPRequestBuilder.fromURI(silentUri("/manifest.yaml")).GET();
    var timeout = request.requestImpl().timeout();
    assertTrue("A GET request has a response timeout", timeout.isPresent());
    assertThat(timeout.get(), lessThanOrEqualTo(Duration.ofMinutes(1)));
  }

  @Test(timeout = 30_000)
  public void fetchingFromAServerThatNeverAnswersFails() {
    var request =
        HTTPRequestBuilder.fromURI(silentUri("/manifest.yaml"))
            .withResponseTimeout(Duration.ofMillis(500))
            .GET();
    var result =
        TaskProgress.waitForTask(
            HTTPDownload.fetchString(request, Option.empty(), StandardCharsets.UTF_8));
    assertTrue("The fetch fails", result.isFailure());
    var error = result.failed().get();
    assertThat(error, instanceOf(HTTPException.class));
    assertThat(error.getMessage(), containsString("did not respond within 500 ms"));
  }

  @Test(timeout = 30_000)
  public void downloadingFromAServerThatNeverAnswersFails() throws IOException {
    var destination = Files.createTempFile("silent-download", ".tgz");
    try {
      var request =
          HTTPRequestBuilder.fromURI(silentUri("/main.tgz"))
              .withResponseTimeout(Duration.ofMillis(500))
              .GET();
      var result =
          TaskProgress.waitForTask(HTTPDownload.download(request, destination, Option.empty()));
      assertTrue("The download fails", result.isFailure());
      var error = result.failed().get();
      assertThat(error, instanceOf(HTTPException.class));
      assertThat(error.getMessage(), containsString("did not respond within 500 ms"));
    } finally {
      Files.deleteIfExists(destination);
    }
  }

  @Test(timeout = 30_000)
  public void aServerThatTimedOutIsNotAskedAgainAtOnce() {
    var timeout = Duration.ofSeconds(2);
    var first =
        TaskProgress.waitForTask(
            HTTPDownload.fetchString(
                HTTPRequestBuilder.fromURI(silentUri("/Standard/Base/manifest.yaml"))
                    .withResponseTimeout(timeout)
                    .GET(),
                Option.empty(),
                StandardCharsets.UTF_8));
    assertTrue("The first fetch fails", first.isFailure());

    var start = System.nanoTime();
    var second =
        TaskProgress.waitForTask(
            HTTPDownload.fetchString(
                HTTPRequestBuilder.fromURI(silentUri("/Standard/Table/manifest.yaml"))
                    .withResponseTimeout(timeout)
                    .GET(),
                Option.empty(),
                StandardCharsets.UTF_8));
    var waited = Duration.ofNanos(System.nanoTime() - start);
    assertTrue("The second fetch fails", second.isFailure());
    assertThat("The second fetch does not wait again", waited, lessThan(Duration.ofSeconds(1)));
    var message = second.failed().get().getMessage();
    assertThat(message, containsString("did not respond within 2 seconds"));
    assertThat(message, containsString("will be asked again in about 120 s"));
  }

  @Test(timeout = 30_000)
  public void aServerIsAskedAgainOnceTheMemoryEnds() throws InterruptedException {
    HTTPDownload$.MODULE$.unresponsiveServerMemory_$eq(Duration.ofSeconds(2));
    var timeout = Duration.ofMillis(500);
    assertTrue("The first fetch fails", fetch(silentUri("/a"), timeout).isFailure());

    var refused = fetch(silentUri("/b"), timeout);
    assertThat(refused.failed().get().getMessage(), containsString("will be asked again in about"));

    // Well past the 2 s memory.
    Thread.sleep(2_500);
    var start = System.nanoTime();
    var asked = fetch(silentUri("/c"), timeout);
    var waited = Duration.ofNanos(System.nanoTime() - start);
    assertTrue("The fetch after the memory ends fails", asked.isFailure());
    assertThat("It was sent and waited", waited, greaterThanOrEqualTo(Duration.ofMillis(400)));
    var message = asked.failed().get().getMessage();
    assertThat(message, containsString("did not respond within 500 ms"));
    assertThat(message, not(containsString("asked again")));
  }

  @Test(timeout = 30_000)
  public void anAnswerFromTheServerForgetsThatItTimedOut() throws Exception {
    // Both requests pass the check before either finishes. `/slow` times out and the server is
    // remembered; only then is `/fast` let answer, which forgets it.
    fastMayAnswer = new CountDownLatch(1);
    var slow =
        HTTPDownload.fetchString(
            HTTPRequestBuilder.fromURI(answeringUri("/slow"))
                .withResponseTimeout(Duration.ofMillis(300))
                .GET(),
            Option.empty(),
            StandardCharsets.UTF_8);
    var fast =
        HTTPDownload.fetchString(
            HTTPRequestBuilder.fromURI(answeringUri("/fast"))
                .withResponseTimeout(Duration.ofSeconds(10))
                .GET(),
            Option.empty(),
            StandardCharsets.UTF_8);
    assertTrue("`/slow` times out", TaskProgress.waitForTask(slow).isFailure());
    fastMayAnswer.countDown();
    assertTrue("`/fast` is answered", TaskProgress.waitForTask(fast).isSuccess());

    var again = fetch(answeringUri("/fast"), Duration.ofSeconds(10));
    assertTrue("The server is asked again and answers", again.isSuccess());
  }

  @Test
  public void aConnectTimeoutSaysTheConnectionWasNotMade() {
    var request = HTTPRequestBuilder.fromURI(silentUri("/manifest.yaml")).GET();
    var error =
        HTTPDownload$.MODULE$.describeFailure(
            request, new HttpConnectTimeoutException("HTTP connect timed out"));
    assertThat(
        error.getMessage(),
        containsString(
            "Could not connect to [" + silentUri("/manifest.yaml") + "] within 30 seconds"));
  }

  @Test
  public void aPostRequestHasNoResponseTimeout() throws IOException {
    // An upload is answered only once its body is sent, so a response timeout would cut a large
    // upload short.
    Path file = Files.createTempFile("upload", ".txt");
    try {
      var request =
          HTTPRequestBuilder.fromURI(silentUri("/upload"))
              .postFiles(scala.jdk.javaapi.CollectionConverters.asScala(List.of(file)).toSeq())
              .build();
      assertTrue(
          "A POST request has no response timeout", request.requestImpl().timeout().isEmpty());
    } finally {
      Files.deleteIfExists(file);
    }
  }
}
