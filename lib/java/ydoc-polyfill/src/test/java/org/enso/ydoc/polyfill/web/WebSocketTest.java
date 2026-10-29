package org.enso.ydoc.polyfill.web;

import io.helidon.common.buffers.BufferData;
import io.helidon.webserver.WebServer;
import io.helidon.webserver.websocket.WsRouting;
import io.helidon.websocket.WsListener;
import io.helidon.websocket.WsSession;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicReferenceArray;
import org.enso.ydoc.polyfill.ExecutorSetup;
import org.graalvm.polyglot.Context;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

public class WebSocketTest extends ExecutorSetup {

  private Context context;
  private ExecutorService webServerExecutor;
  private WebServer ws;
  private int port;

  public WebSocketTest() {}

  private WebServer startWebSocketServer(ExecutorService executor) {
    var routing = WsRouting.builder().endpoint("/", new TestWsListener());
    var ws = WebServer.builder().host("localhost").port(port).addRouting(routing).build();

    executor.submit(ws::start);

    return ws;
  }

  @Before
  public void setup() throws Exception {
    super.setup();
    webServerExecutor = Executors.newSingleThreadExecutor();
    port = TimedLock.freePort();
    ws = startWebSocketServer(webServerExecutor);

    var hostAccess =
        WebEnvironment.defaultHostAccess
            .allowAccess(AtomicBoolean.class.getDeclaredMethod("set", boolean.class))
            .allowAccess(AtomicReference.class.getDeclaredMethod("set", Object.class))
            .allowAccess(
                AtomicReferenceArray.class.getDeclaredMethod("set", int.class, Object.class))
            .allowAccess(TimedLock.class.getDeclaredMethod("acquire", int.class))
            .allowAccess(TimedLock.class.getDeclaredMethod("release"))
            .build();
    var contextBuilder = WebEnvironment.createContext(hostAccess);

    context =
        CompletableFuture.supplyAsync(
                () -> {
                  var ctx = contextBuilder.build();
                  WebEnvironment.initialize(ctx, executor);
                  ctx.getBindings("js").putMember("port", port);
                  return ctx;
                },
                executor)
            .get();
  }

  @After
  public void tearDown() throws InterruptedException {
    ws.stop();
    webServerExecutor.shutdown();
    super.tearDown();
    context.close();
  }

  @Test
  public void addEventListenerOpen() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicBoolean(false);

    var code =
        """
        var ws = new WebSocket('ws://localhost:' + port);
        ws.addEventListener('open', () => {
          res.set(true);
          lock.release();
        });
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(1);

    Assert.assertTrue(res.get());
  }

  @Test
  public void dispatchClonedEvent() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicReferenceArray<>(new Object[2]);

    var code =
        """
        var count = 0;
        var cloneEvent = (e) => new e.constructor(e.type, e);
        var ws = new WebSocket('ws://localhost:' + port);
        var cb = (event) => {
          res.set(count, event.data);
          count += 1;
          if (count == 2) {
            ws.removeEventListener('message', cb);
          }
          ws.dispatchEvent(cloneEvent(event));
          lock.release();
        }
        ws.addEventListener('open', () => {
          ws.send('hello');
        });
        ws.addEventListener('message', cb);
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(2);

    Assert.assertEquals("hello", res.get(0));
    Assert.assertEquals("hello", res.get(1));
  }

  @Test
  public void onOpen() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicBoolean(false);

    var code =
        """
        var ws = new WebSocket('ws://localhost:' + port);
        ws.on('open', () => {
          res.set(true);
          lock.release();
        });
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(1);

    Assert.assertTrue(res.get());
  }

  @Test
  public void sendText() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicReference<>();

    var code =
        """
        var ws = new WebSocket('ws://localhost:' + port);
        ws.addEventListener('open', () => {
          ws.send('Hello!');
        });
        ws.onmessage = (event) => {
          res.set(event.data);
          lock.release();
        };
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(1);

    Assert.assertEquals("Hello!", res.get());
  }

  @Test
  public void sendBinary() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicReference<>();

    var code =
        """
        const ws = new WebSocket('ws://localhost:' + port);
        ws.on('open', () => {
          ws.send(new Uint8Array([0, 31, 255]));
        });
        ws.on('message', (data) => {
          res.set(new Uint8Array(data).toString());
          lock.release();
        });
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(1);

    Assert.assertEquals("0,31,255", res.get());
  }

  @Test
  public void ping() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicBoolean(false);

    var code =
        """
        const ws = new WebSocket('ws://localhost:' + port);
        ws.on('open', () => {
          ws.ping();
        });
        ws.on('pong', () => {
          res.set(true);
          lock.release();
        });
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    lock.acquire(1);

    Assert.assertTrue(res.get());
  }

  @Test
  public void closeIdempotent() throws Exception {
    var lock = new TimedLock();
    var res = new AtomicBoolean(false);

    var code =
        """
        var ws = new WebSocket('ws://localhost:' + port);
        ws.addEventListener('open', () => {
          ws.close();
          ws.close();
          res.set(true);
          // Notify that the client socket is closed
          lock.release();
        });
        """;

    context.getBindings("js").putMember("lock", lock);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    // Wait until the client socket is closed
    lock.acquire(1);

    Assert.assertTrue(res.get());
  }

  @Test
  public void handleSocketClosed() throws Exception {
    var lock1 = new TimedLock();
    var lock2 = new TimedLock();
    var lock3 = new TimedLock();
    var res = new AtomicBoolean(false);

    var code =
        """
        var ws = new WebSocket('ws://localhost:' + port);
        ws.addEventListener('open', () => {
          // Notify that the client socket is connected
          lock1.release();
          // Wait until the server socket is closed
          lock2.acquire(1);
          // Close the client socket (closed by the server)
          ws.close();
          res.set(true);
          // Notify that the client socket is closed
          lock3.release();
        });
        """;

    context.getBindings("js").putMember("lock1", lock1);
    context.getBindings("js").putMember("lock2", lock2);
    context.getBindings("js").putMember("lock3", lock3);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    // Wait for the client socket connection
    lock1.acquire(1);
    // Close the server socket
    ws.stop();
    // Notify that the server socked is closed
    lock2.release();
    // Wait until the client socket is closed
    lock3.acquire(1);

    Assert.assertTrue(res.get());
  }

  /**
   * The server closes the connection, then the client closes its socket again, with and without a
   * close code. Neither call may throw, and the {@code close} event is dispatched exactly once
   * (#409).
   */
  @Test
  public void closeAfterServerClosedDoesNotThrowOrDispatchTwice() throws Exception {
    var connected = new TimedLock();
    var closedByServer = new TimedLock();
    var done = new TimedLock();
    var res = new AtomicReferenceArray<>(new Object[2]);

    var code =
        """
        var closeEvents = 0;
        var ws = new WebSocket('ws://localhost:' + port);
        ws.addEventListener('close', () => { closeEvents += 1; });
        ws.addEventListener('open', () => {
          connected.release();
          closedByServer.acquire(1);
          try {
            ws.close();
            ws.close(1000, 'bye');
            res.set(0, 'no throw');
          } catch (e) {
            res.set(0, 'threw: ' + e);
          }
          res.set(1, ws.readyState);
          done.release();
        });
        """;

    context.getBindings("js").putMember("connected", connected);
    context.getBindings("js").putMember("closedByServer", closedByServer);
    context.getBindings("js").putMember("done", done);
    context.getBindings("js").putMember("res", res);

    CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    connected.acquire(1);
    ws.stop();
    closedByServer.release();
    done.acquire(1);

    Assert.assertEquals("no throw", res.get(0));
    Assert.assertEquals(3, res.get(1));

    // The close notification queued behind the handler must arrive once, and only once.
    var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (closeEvents() == 0 && System.nanoTime() < deadline) {
      Thread.sleep(50);
    }
    Thread.sleep(300);
    Assert.assertEquals(1, closeEvents());
  }

  private int closeEvents() throws Exception {
    return CompletableFuture.supplyAsync(() -> context.eval("js", "closeEvents").asInt(), executor)
        .get();
  }

  @Test
  public void reassembleFragmentedBinaryMessage() throws Exception {
    var fragmentPort = TimedLock.freePort();
    var fragmentServer =
        WebServer.builder()
            .host("localhost")
            .port(fragmentPort)
            .addRouting(WsRouting.builder().endpoint("/", new FragmentingWsListener()))
            .build();
    fragmentServer.start();

    try {
      var lock = new TimedLock();
      var res = new AtomicReference<>();

      var code =
          """
          const ws = new WebSocket('ws://localhost:' + fragmentPort);
          ws.on('open', () => {
            ws.send('trigger');
          });
          ws.on('message', (data) => {
            res.set(new Uint8Array(data).toString());
            lock.release();
          });
          """;

      context.getBindings("js").putMember("fragmentPort", fragmentPort);
      context.getBindings("js").putMember("lock", lock);
      context.getBindings("js").putMember("res", res);

      CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

      lock.acquire(1);

      Assert.assertEquals("1,2,3,4,5,6", res.get());
    } finally {
      fragmentServer.stop();
    }
  }

  private static final class FragmentingWsListener implements WsListener {
    FragmentingWsListener() {}

    @Override
    public void onMessage(WsSession session, String text, boolean last) {
      // Reply with a single logical binary message split across 3 WebSocket frames
      session.send(BufferData.create(new byte[] {1, 2}), false);
      session.send(BufferData.create(new byte[] {3, 4}), false);
      session.send(BufferData.create(new byte[] {5, 6}), true);
    }
  }

  private static final class TestWsListener implements WsListener {
    TestWsListener() {}

    @Override
    public void onMessage(WsSession session, String text, boolean last) {
      session.send(text, last);
    }

    @Override
    public void onMessage(WsSession session, BufferData buffer, boolean last) {
      session.send(buffer, last);
    }

    @Override
    public void onPing(WsSession session, BufferData buffer) {
      session.pong(buffer);
    }
  }
}
