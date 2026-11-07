package org.enso.downloader.http;

import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.instanceOf;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.enso.cli.task.TaskProgress;
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
  }

  @AfterClass
  public static void stopSilentServer() throws IOException {
    silentServer.close();
    for (var socket : acceptedSockets) {
      socket.close();
    }
  }

  @Before
  public void forgetUnresponsiveServers() {
    HTTPDownload$.MODULE$.forgetUnresponsiveServers();
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
    assertThat(message, containsString("did not respond within 2 seconds to an earlier request"));
    assertThat(message, containsString("/Standard/Table/manifest.yaml"));
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
