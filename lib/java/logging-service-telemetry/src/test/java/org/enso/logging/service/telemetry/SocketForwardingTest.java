package org.enso.logging.service.telemetry;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.Assert.assertTrue;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import ch.qos.logback.core.util.Duration;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.enso.logging.service.logback.DeferredProcessingSocketAppender;
import org.enso.logging.service.logback.SocketServer;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

/**
 * Round trip through the socket forwarding that engine processes use to send their logs to a
 * logging server: {@link DeferredProcessingSocketAppender} on one side, {@link SocketServer} (which
 * deserializes through logback's {@code HardenedLoggingEventInputStream}) on the other.
 */
public class SocketForwardingTest {
  private LoggerContext serverContext;
  private SocketServer server;
  private DeferredProcessingSocketAppender appender;
  private Logger sender;
  private final List<ILoggingEvent> received = new CopyOnWriteArrayList<>();

  @Before
  public void setup() throws Exception {
    int port;
    try (var s = new ServerSocket(0)) {
      port = s.getLocalPort();
    }

    // Set up like `LoggingServer.start`.
    serverContext = new LoggerContext();
    serverContext.setMDCAdapter(MDC.getMDCAdapter());
    var collector =
        new AppenderBase<ILoggingEvent>() {
          @Override
          protected void append(ILoggingEvent event) {
            // Pattern and file appenders read the MDC; since logback 1.5 this throws for an
            // event whose context has no MDC adapter.
            event.getMDCPropertyMap();
            received.add(event);
          }
        };
    collector.setContext(serverContext);
    collector.start();
    var serverRoot = serverContext.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
    serverRoot.setLevel(Level.TRACE);
    serverRoot.addAppender(collector);
    server = new SocketServer(serverContext, port);
    server.start();
    awaitListening(port);

    // The sending side logs through the default SLF4J context, as engine processes do.
    var clientContext = (LoggerContext) LoggerFactory.getILoggerFactory();
    appender = new DeferredProcessingSocketAppender();
    appender.setContext(clientContext);
    appender.setName("socket-forwarding-test");
    appender.setRemoteHost("localhost");
    appender.setPort(port);
    appender.setReconnectionDelay(Duration.buildByMilliseconds(100));
    appender.start();
    sender = clientContext.getLogger(SocketForwardingTest.class.getName() + ".Sender");
    sender.setAdditive(false);
    sender.setLevel(Level.TRACE);
    sender.addAppender(appender);
  }

  @After
  public void teardown() {
    sender.detachAppender(appender);
    appender.stop();
    server.close();
    MDC.clear();
  }

  /** {@link SocketServer} binds on its own thread; connecting earlier is refused. */
  private static void awaitListening(int port) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 15_000;
    while (System.currentTimeMillis() < deadline) {
      try (var probe = new Socket("localhost", port)) {
        return;
      } catch (IOException e) {
        Thread.sleep(20);
      }
    }
    throw new AssertionError("Logging server did not start listening on port " + port);
  }

  private ILoggingEvent awaitMessage(String prefix) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 15_000;
    while (System.currentTimeMillis() < deadline) {
      for (var event : received) {
        if (event.getFormattedMessage().startsWith(prefix)) {
          return event;
        }
      }
      Thread.sleep(50);
    }
    throw new AssertionError(
        "No event starting with '"
            + prefix
            + "' received; got "
            + received.stream().map(ILoggingEvent::getFormattedMessage).toList()
            + "; sender status: "
            + appender.getContext().getStatusManager().getCopyOfStatusList());
  }

  @Test
  public void forwardsMessagesWithMdcAndThrowables() throws Exception {
    MDC.put("projectLocalId", "project-1");
    sender.info("hello {}", "world");
    sender.error("failure", new IllegalStateException("boom", new RuntimeException("cause")));

    var hello = awaitMessage("hello world");
    assertThat(hello.getLevel(), is(Level.INFO));
    assertThat(hello.getMDCPropertyMap().get("projectLocalId"), is("project-1"));

    var failure = awaitMessage("failure");
    assertThat(failure.getThrowableProxy(), notNullValue());
    assertThat(failure.getThrowableProxy().getMessage(), is("boom"));
    assertThat(failure.getThrowableProxy().getCause().getMessage(), is("cause"));
  }

  @Test
  public void reportsArgumentsThatFailToSerialize() throws Exception {
    var broken =
        new Object() {
          @Override
          public String toString() {
            throw new IllegalStateException("toString failed");
          }
        };
    sender.info("broken {}", broken);
    sender.info("still connected");

    var report = awaitMessage("Internal error during serialization");
    assertThat(report.getFormattedMessage(), startsWith("Internal error during serialization"));
    awaitMessage("still connected");
  }

  @Test
  public void acceptsEventsLoggedDirectlyOnTheServerContext() throws Exception {
    serverContext.getLogger("server.local").info("local message");
    var local = awaitMessage("local message");
    assertTrue(local.getMDCPropertyMap() != null);
    assertThat(
        received.stream().map(ILoggingEvent::getFormattedMessage).toList(),
        hasItem("local message"));
  }
}
