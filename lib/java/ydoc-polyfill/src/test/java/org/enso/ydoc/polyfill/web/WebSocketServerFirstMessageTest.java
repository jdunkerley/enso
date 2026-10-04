package org.enso.ydoc.polyfill.web;

import io.helidon.common.buffers.BufferData;
import io.helidon.webclient.websocket.WsClient;
import io.helidon.websocket.WsListener;
import io.helidon.websocket.WsSession;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.enso.ydoc.polyfill.ExecutorSetup;
import org.graalvm.polyglot.Context;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

/**
 * A server that writes to a socket as soon as {@code onconnect} hands it over must have that
 * message delivered. The ydoc server does exactly this: {@code YjsConnection} sends its first sync
 * message from its constructor, and a lost first message leaves the GUI waiting until {@code
 * y-websocket} gives up on the silent socket 30 s later (#214).
 */
public class WebSocketServerFirstMessageTest extends ExecutorSetup {

  private static final int PORT = 33446;
  private static final int CONNECTIONS = 100;

  private Context context;

  @Before
  public void setup() throws Exception {
    super.setup();

    var hostAccess =
        WebEnvironment.defaultHostAccess
            .allowAccess(CopyOnWriteArrayList.class.getDeclaredMethod("add", Object.class))
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
  public void firstMessageSentFromOnConnectIsDelivered() throws Exception {
    var sendErrors = new CopyOnWriteArrayList<Object>();
    var code =
        """
        const wss = new WebSocketServer({host: 'localhost', port: %d});
        wss.onconnect = (ws, url) => {
            try {
                ws.send(new Uint8Array([0, 0, 1, 0]));
            } catch (e) {
                sendErrors.add(url.pathname + ': ' + e);
            }
        };
        wss.start();
        """
            .formatted(PORT);
    context.getBindings("js").putMember("sendErrors", sendErrors);
    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    var client = WsClient.builder().build();
    var missed = new ArrayList<Integer>();
    for (var i = 0; i < CONNECTIONS; i++) {
      var listener = new FirstMessageListener();
      client.connect("ws://localhost:" + PORT + "/doc-" + i, listener);
      try {
        listener.firstMessage.get(5, TimeUnit.SECONDS);
      } catch (java.util.concurrent.TimeoutException e) {
        missed.add(i);
      } finally {
        listener.close();
      }
    }

    Assert.assertEquals("send errors: " + sendErrors, List.of(), sendErrors);
    Assert.assertEquals("connections that never got their first message", List.of(), missed);
  }

  private static final class FirstMessageListener implements WsListener {
    final CompletableFuture<byte[]> firstMessage = new CompletableFuture<>();
    private volatile WsSession session;

    @Override
    public void onOpen(WsSession session) {
      this.session = session;
    }

    @Override
    public void onMessage(WsSession session, BufferData buffer, boolean last) {
      firstMessage.complete(buffer.readBytes());
    }

    void close() {
      var s = session;
      if (s != null) s.close(1000, "done");
    }
  }
}
