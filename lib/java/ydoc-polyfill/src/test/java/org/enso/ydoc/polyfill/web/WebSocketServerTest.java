package org.enso.ydoc.polyfill.web;

import io.helidon.webclient.websocket.WsClient;
import io.helidon.websocket.WsListener;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReferenceArray;
import org.enso.ydoc.polyfill.ExecutorSetup;
import org.graalvm.polyglot.Context;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

public class WebSocketServerTest extends ExecutorSetup {

  private Context context;

  public WebSocketServerTest() {}

  @Before
  public void setup() throws Exception {
    super.setup();

    var hostAccess =
        WebEnvironment.defaultHostAccess
            .allowAccess(
                AtomicReferenceArray.class.getDeclaredMethod("set", int.class, Object.class))
            .allowAccess(TimedLock.class.getDeclaredMethod("release"))
            .build();
    var contextBuilder = WebEnvironment.createContext(hostAccess);

    context =
        CompletableFuture.supplyAsync(
                () -> {
                  var ctx = contextBuilder.build();
                  WebEnvironment.initialize(ctx, executor);
                  return ctx;
                },
                executor)
            .get();
  }

  @After
  public void tearDown() throws InterruptedException {
    super.tearDown();
    context.close();
  }

  @Test
  public void webSocketServer() throws Exception {
    var lock = new TimedLock();
    var port = TimedLock.freePort();
    var res = new AtomicReferenceArray<>(new Object[3]);

    var code =
        """
        const onconnect = (ws, url) => {
            res.set(0, ws.readyState === WebSocket.OPEN);
            res.set(1, url.pathname);
            res.set(2, url.searchParams.toString());
            lock.release();
        }

        let wss = new WebSocketServer({host: 'localhost', port: port});
        wss.onconnect = onconnect;

        wss.start();
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("port", port);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    var ws = WsClient.builder().build();
    ws.connect("ws://localhost:" + port + "/hello?foo=bar", new TestWsListener());

    lock.acquire(1);

    Assert.assertTrue((boolean) res.get(0));
    Assert.assertEquals("/hello", res.get(1));
    Assert.assertEquals("foo=bar", res.get(2));
  }

  /**
   * The status a WebSocket handshake for {@code target} gets, sent raw so that {@code Origin} can
   * be set (or left out) as a browser would.
   */
  static int handshakeStatus(int port, String target, String origin) throws IOException {
    try (var socket = new Socket("localhost", port)) {
      socket.setSoTimeout(10_000);
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
      Assert.assertNotNull("No response to the handshake for " + target, statusLine);
      return Integer.parseInt(statusLine.split(" ")[1]);
    }
  }

  /** Note [The Engine-Hosted Listener Refuses Before The Upgrade] (#614). */
  @Test
  public void verifyClientRefusesBeforeTheUpgrade() throws Exception {
    var port = TimedLock.freePort();
    var seen = new AtomicReferenceArray<>(new Object[4]);
    var connected = new AtomicReferenceArray<>(new Object[8]);

    var code =
        """
        let count = 0;
        const verifyClient = (url, origin) => {
            seen.set(0, url.pathname);
            seen.set(1, url.searchParams.get('ls'));
            seen.set(2, origin);
            if (url.pathname === '/throws') throw new Error('verifyClient failed');
            if (origin != null && origin !== 'https://localhost:1234')
                return {status: 403, reason: 'Forbidden'};
            if (url.pathname === '/missing') return {status: 404};
            if (url.pathname === '/bad') return {status: 400, reason: 'Bad'};
            return undefined;
        };
        let wss = new WebSocketServer({host: 'localhost', port: port, verifyClient});
        wss.onconnect = (ws, url) => connected.set(count++, url.pathname);
        wss.start();
        """;

    context.getBindings("js").putMember("port", port);
    context.getBindings("js").putMember("seen", seen);
    context.getBindings("js").putMember("connected", connected);
    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    // A Node client (no Origin) and the app's own page are upgraded.
    Assert.assertEquals(101, handshakeStatus(port, "/accepted?ls=x", null));
    Assert.assertEquals("/accepted", seen.get(0));
    Assert.assertEquals("x", seen.get(1));
    Assert.assertNull(seen.get(2));
    Assert.assertEquals(
        101, handshakeStatus(port, "/accepted-page?ls=x", "https://localhost:1234"));
    Assert.assertEquals("https://localhost:1234", seen.get(2));

    // Refused with the status `verifyClient` names, before the upgrade.
    Assert.assertEquals(403, handshakeStatus(port, "/refused?ls=x", "https://evil.example"));
    Assert.assertEquals(404, handshakeStatus(port, "/missing?ls=x", null));
    Assert.assertEquals(400, handshakeStatus(port, "/bad", null));
    // A check that fails refuses too.
    Assert.assertEquals(500, handshakeStatus(port, "/throws", null));

    // Only the two accepted sockets reached `onconnect`.
    for (var i = 0; i < 50 && connected.get(1) == null; i++) Thread.sleep(100);
    Thread.sleep(200);
    Assert.assertEquals(
        java.util.Set.of("/accepted", "/accepted-page"),
        java.util.Set.of(connected.get(0), connected.get(1)));
    Assert.assertNull(connected.get(2));
  }

  private static final class TestWsListener implements WsListener {
    TestWsListener() {}
  }
}
