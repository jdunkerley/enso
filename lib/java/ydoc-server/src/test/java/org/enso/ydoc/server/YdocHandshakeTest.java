package org.enso.ydoc.server;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.enso.ydoc.api.YjsChannel;
import org.enso.ydoc.polyfill.web.WebEnvironment;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

/**
 * The engine-hosted listener refuses before the upgrade what the Node host refuses (#614): a
 * foreign {@code Origin} and an unknown document. See Note [The Engine-Hosted Listener Checks
 * Origin] in {@link Ydoc}.
 */
public class YdocHandshakeTest {

  private static final String APP_ORIGIN = "https://localhost:5000";
  private static final String LS = "ws://127.0.0.1:44557";

  private ExecutorService executor;
  private volatile Ydoc ydoc;
  private int port;

  @Before
  public void setup() throws IOException {
    executor = Executors.newSingleThreadExecutor(r -> new Thread(r, "ydoc-handshake-test"));
    try (var socket = new ServerSocket(0)) {
      port = socket.getLocalPort();
    }
  }

  @After
  public void tearDown() throws Exception {
    if (ydoc != null) {
      // Let the callbacks of the sockets the test has just closed run first: closing the context
      // under them prints "Context execution was cancelled" traces that look like a failure.
      Thread.sleep(1_000);
      ydoc.close();
    }
    executor.shutdownNow();
    executor.awaitTermination(3, TimeUnit.SECONDS);
  }

  /** Start the listener with these allowed origins, and wait until it answers. */
  private void start(String allowedOrigins) throws Exception {
    executor.submit(
        () -> {
          var hostAccess =
              WebEnvironment.defaultHostAccess
                  .allowImplementations(YjsChannel.class)
                  .allowPublicAccess(true);
          var builder = Ydoc.builder().hostAccess(hostAccess.build()).port(port);
          if (allowedOrigins != null) {
            builder.allowedOrigins(allowedOrigins);
          }
          ydoc = builder.build();
          ydoc.start();
          return null;
        });
    var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
    while (true) {
      try (var socket = new Socket("localhost", port)) {
        return;
      } catch (IOException notYet) {
        if (System.nanoTime() > deadline) {
          throw new AssertionError("The ydoc listener did not start", notYet);
        }
        Thread.sleep(100);
      }
    }
  }

  /** The status a raw WebSocket handshake for {@code target} gets, with or without Origin. */
  private int handshake(String target, String origin) throws IOException {
    try (var socket = new Socket("localhost", port)) {
      socket.setSoTimeout(30_000);
      var request =
          "GET "
              + target
              + " HTTP/1.1\r\n"
              + "Host: localhost:"
              + port
              + "\r\n"
              + "Upgrade: websocket\r\n"
              + "Connection: Upgrade\r\n"
              + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
              + "Sec-WebSocket-Version: 13\r\n"
              + (origin == null ? "" : "Origin: " + origin + "\r\n")
              + "\r\n";
      socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
      socket.getOutputStream().flush();
      var reader =
          new BufferedReader(
              new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
      var statusLine = reader.readLine();
      Assert.assertNotNull("No answer to the handshake for " + target, statusLine);
      return Integer.parseInt(statusLine.split(" ")[1]);
    }
  }

  private static String doc(String name) {
    return "/project/" + name + "?ls=" + LS + "&data=" + LS;
  }

  @Test(timeout = 120_000)
  public void refusesForeignOriginsAndUnknownDocuments() throws Exception {
    start(APP_ORIGIN + ",https://127.0.0.1:5000");

    // Accepted: a client without Origin (Node, tools, tests) and the app's own window.
    Assert.assertEquals(101, handshake(doc("index"), null));
    Assert.assertEquals(101, handshake(doc("index"), APP_ORIGIN));
    Assert.assertEquals(101, handshake(doc("index"), "https://127.0.0.1:5000"));

    // Refused before the upgrade: another site, another port, another scheme, the opaque origin.
    Assert.assertEquals(403, handshake(doc("index"), "https://evil.example"));
    Assert.assertEquals(403, handshake(doc("index"), "https://localhost:5001"));
    Assert.assertEquals(403, handshake(doc("index"), "http://localhost:5000"));
    Assert.assertEquals(403, handshake(doc("index"), "null"));

    // A module doc the session does not hold: 404 before the upgrade, not upgraded and closed.
    Assert.assertEquals(404, handshake(doc("0a1b2c3d-unknown"), null));
    // No ls= parameter: 400.
    Assert.assertEquals(400, handshake("/project/index", null));
  }

  @Test(timeout = 120_000)
  public void withoutAllowedOriginsRefusesEveryPage() throws Exception {
    start("");
    Assert.assertEquals(403, handshake(doc("index"), APP_ORIGIN));
    Assert.assertEquals(101, handshake(doc("index"), null));
  }
}
