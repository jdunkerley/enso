package org.enso.downloader.http;

import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.instanceOf;
import static org.hamcrest.CoreMatchers.is;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.lessThan;
import static org.junit.Assert.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Duration;
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
 * What happens to a response once its headers have arrived (#637): a body that goes quiet ends the
 * download, a slow but steady one does not; and the headers a request was given reach the server.
 *
 * <p>The JDK's request timeout covers only the wait for the headers, so without the idle timeout of
 * {@link HTTPDownload} the first test would never end.
 */
public class HttpDownloadBodyTest {

  private static final Duration IDLE = Duration.ofMillis(500);
  private static final int CHUNK_COUNT = 8;
  private static final int CHUNK_DELAY_MILLIS = 200;

  private static HttpServer server;
  private static ExecutorService executor;
  private static final CountDownLatch release = new CountDownLatch(1);

  @BeforeClass
  public static void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    executor =
        Executors.newCachedThreadPool(
            runnable -> {
              var thread = new Thread(runnable, "body-test-http-server");
              thread.setDaemon(true);
              return thread;
            });
    server.setExecutor(executor);

    // The headers and some of the body, then silence.
    server.createContext(
        "/stalls",
        exchange -> {
          try {
            exchange.sendResponseHeaders(200, 1000);
            var out = exchange.getResponseBody();
            out.write("start".getBytes(StandardCharsets.UTF_8));
            out.flush();
            release.await(20, TimeUnit.SECONDS);
          } catch (InterruptedException | IOException e) {
            // The client gave up: nothing to send.
          } finally {
            exchange.close();
          }
        });

    // A chunk every 200 ms, 1.6 s in all: well over the idle timeout, never idle for it.
    server.createContext(
        "/trickles",
        exchange -> {
          try {
            exchange.sendResponseHeaders(200, CHUNK_COUNT);
            var out = exchange.getResponseBody();
            for (int i = 0; i < CHUNK_COUNT; i++) {
              Thread.sleep(CHUNK_DELAY_MILLIS);
              out.write('x');
              out.flush();
            }
          } catch (InterruptedException | IOException e) {
            // The client gave up: nothing to send.
          } finally {
            exchange.close();
          }
        });

    // Answers with the value of the `Accept` header it received.
    server.createContext(
        "/accept",
        exchange -> {
          var accept = exchange.getRequestHeaders().getFirst("Accept");
          answer(exchange, accept == null ? "<none>" : accept);
        });
    server.start();
  }

  private static void answer(HttpExchange exchange, String text) throws IOException {
    var body = text.getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(200, body.length);
    exchange.getResponseBody().write(body);
    exchange.close();
  }

  @AfterClass
  public static void stopServer() {
    release.countDown();
    server.stop(0);
    executor.shutdownNow();
  }

  @Before
  public void shortenTheIdleTimeout() {
    HTTPDownload$.MODULE$.forgetUnresponsiveServers();
    HTTPDownload$.MODULE$.bodyIdleTimeout_$eq(IDLE);
  }

  @After
  public void restoreTheIdleTimeout() {
    HTTPDownload$.MODULE$.bodyIdleTimeout_$eq(HTTPDownload.BodyIdleTimeout());
  }

  private static URI uri(String path) {
    return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path);
  }

  @Test
  public void theBodyIdleTimeoutIsAReasonableTime() {
    assertThat(HTTPDownload.BodyIdleTimeout(), lessThan(Duration.ofMinutes(2)));
    assertThat(HTTPDownload.BodyIdleTimeout(), greaterThan(Duration.ofSeconds(5)));
  }

  @Test(timeout = 30_000)
  public void fetchingABodyThatStallsFails() {
    var start = System.nanoTime();
    var result =
        TaskProgress.waitForTask(
            HTTPDownload.fetchString(
                HTTPRequestBuilder.fromURI(uri("/stalls")).GET(),
                Option.empty(),
                StandardCharsets.UTF_8));
    var waited = Duration.ofNanos(System.nanoTime() - start);
    assertTrue("The fetch fails", result.isFailure());
    var error = result.failed().get();
    assertThat(error, instanceOf(HTTPException.class));
    assertThat(error.getMessage(), containsString("stalled"));
    assertThat(error.getMessage(), containsString("no data arrived for 500 ms"));
    assertThat(error.getMessage(), containsString(uri("/stalls").toString()));
    assertThat(waited, lessThan(Duration.ofSeconds(10)));
  }

  @Test(timeout = 30_000)
  public void downloadingABodyThatStallsFails() throws IOException {
    var destination = Files.createTempFile("stalled-download", ".tgz");
    try {
      var result =
          TaskProgress.waitForTask(
              HTTPDownload.download(
                  HTTPRequestBuilder.fromURI(uri("/stalls")).GET(), destination, Option.empty()));
      assertTrue("The download fails", result.isFailure());
      var error = result.failed().get();
      assertThat(error, instanceOf(HTTPException.class));
      assertThat(error.getMessage(), containsString("stalled"));
    } finally {
      Files.deleteIfExists(destination);
    }
  }

  @Test(timeout = 30_000)
  public void aStalledBodyDoesNotShutTheServerOut() {
    var first =
        TaskProgress.waitForTask(HTTPDownload.fetchString(uri("/stalls")));
    assertTrue("The stalled fetch fails", first.isFailure());
    // The server answered, so it is not "unresponsive": the next request is sent.
    var second = TaskProgress.waitForTask(HTTPDownload.fetchString(uri("/accept")));
    assertTrue("The next fetch is sent", second.isSuccess());
  }

  @Test(timeout = 30_000)
  public void aSlowButSteadyBodyIsNotCutShort() throws IOException {
    var start = System.nanoTime();
    var result = TaskProgress.waitForTask(HTTPDownload.fetchString(uri("/trickles")));
    var took = Duration.ofNanos(System.nanoTime() - start);
    assertTrue("The fetch succeeds: " + result, result.isSuccess());
    assertThat(result.get().content(), is("x".repeat(CHUNK_COUNT)));
    assertThat("It took longer than the idle timeout", took, greaterThan(IDLE));

    var destination = Files.createTempFile("trickled-download", ".bin");
    try {
      var download = TaskProgress.waitForTask(HTTPDownload.download(uri("/trickles"), destination));
      assertTrue("The download succeeds: " + download, download.isSuccess());
      assertThat(Files.readString(destination), is("x".repeat(CHUNK_COUNT)));
    } finally {
      Files.deleteIfExists(destination);
    }
  }

  @Test(timeout = 30_000)
  public void aGetRequestSendsTheHeadersItWasGiven() {
    var request =
        HTTPRequestBuilder.fromURI(uri("/accept"))
            .addHeader("Accept", "application/octet-stream")
            .GET();
    assertThat(
        request.requestImpl().headers().firstValue("Accept").orElse("<none>"),
        is("application/octet-stream"));

    var result =
        TaskProgress.waitForTask(
            HTTPDownload.fetchString(request, Option.empty(), StandardCharsets.UTF_8));
    assertTrue("The fetch succeeds", result.isSuccess());
    assertThat(result.get().content(), is("application/octet-stream"));
  }

  @Test
  public void buildingTwiceDoesNotRepeatTheHeaders() {
    var builder = HTTPRequestBuilder.fromURI(uri("/accept")).addHeader("X-Test", "1");
    builder.GET();
    var headers = builder.build().requestImpl().headers().allValues("X-Test");
    assertThat(headers.size(), is(1));
  }
}
