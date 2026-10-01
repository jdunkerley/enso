package org.enso.logging.service.telemetry;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.not;
import static org.junit.Assert.assertThrows;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.core.util.Duration;
import com.typesafe.config.ConfigFactory;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.enso.logging.config.LoggingServer;
import org.enso.logging.service.LoggingService;
import org.enso.logging.service.logback.DeferredProcessingSocketAppender;
import org.enso.logging.service.logback.LogbackLoggingServiceFactory;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.slf4j.MDC;

/**
 * The logging server a language server starts: on port 0 every instance gets its own port and
 * writes to its own log file, and a port that cannot be bound fails the start. Note [Each Process
 * Hosts Its Own Logging Server] in {@code LoggingSetupHelper}.
 */
public class LoggingServerPortTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private final List<LoggingService<URI>> servers = new ArrayList<>();
  private final List<LoggerContext> clients = new ArrayList<>();

  @After
  public void teardown() {
    clients.forEach(LoggerContext::stop);
    servers.forEach(LoggingService::teardown);
    MDC.clear();
  }

  /** The `logging-service.server` section of `application-ls.conf`, reduced to a log file. */
  private static LoggingServer serverConfig(int port) throws Exception {
    var config =
        ConfigFactory.parseString(
            """
            port = %d
            log-to-file { enable = true, log-level = trace }
            appenders = [ { name = "file", immediate-flush = true }, { name = "console" } ]
            default-appender = console
            """
                .formatted(port));
    return LoggingServer.parse(config);
  }

  private LoggingService<URI> newServer(int port) {
    var server = new LogbackLoggingServiceFactory().localServerFor(port);
    servers.add(server);
    return server;
  }

  private URI start(LoggingService<URI> server, int port, Path logRoot) throws Exception {
    return server.start(
        org.slf4j.event.Level.TRACE, logRoot, "enso-language-server", serverConfig(port));
  }

  /** A language server's own side: its loggers, forwarding to the given logging server. */
  private org.slf4j.Logger clientFor(URI server) {
    var context = new LoggerContext();
    context.setMDCAdapter(MDC.getMDCAdapter());
    context.start();
    clients.add(context);
    var appender = new DeferredProcessingSocketAppender();
    appender.setContext(context);
    appender.setRemoteHost(server.getHost());
    appender.setPort(server.getPort());
    appender.setReconnectionDelay(Duration.buildByMilliseconds(100));
    appender.start();
    var root = context.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
    root.setLevel(Level.TRACE);
    root.addAppender(appender);
    return context.getLogger(LoggingServerPortTest.class);
  }

  private static String awaitLogContaining(Path logRoot, String text) throws Exception {
    long deadline = System.currentTimeMillis() + 15_000;
    String contents = "";
    while (System.currentTimeMillis() < deadline) {
      contents = readLogs(logRoot);
      if (contents.contains(text)) {
        return contents;
      }
      Thread.sleep(50);
    }
    throw new AssertionError("'" + text + "' never reached " + logRoot + "; it has: " + contents);
  }

  private static String readLogs(Path logRoot) throws IOException {
    try (var files = Files.walk(logRoot)) {
      return files
          .filter(f -> f.toString().endsWith(".log"))
          .map(
              f -> {
                try {
                  return Files.readString(f);
                } catch (IOException e) {
                  throw new UncheckedIOException(e);
                }
              })
          .collect(Collectors.joining("\n"));
    }
  }

  @Test
  public void twoServersOnPortZeroGetTheirOwnPortsAndLogFiles() throws Exception {
    var rootA = tmp.newFolder("a").toPath();
    var rootB = tmp.newFolder("b").toPath();
    var uriA = start(newServer(0), 0, rootA);
    var uriB = start(newServer(0), 0, rootB);

    assertThat(uriA.getPort(), greaterThan(0));
    assertThat(uriB.getPort(), greaterThan(0));
    assertThat(uriA.getPort(), not(uriB.getPort()));

    clientFor(uriA).info("message from project A");
    clientFor(uriB).info("message from project B");

    var logA = awaitLogContaining(rootA, "message from project A");
    var logB = awaitLogContaining(rootB, "message from project B");
    assertThat(logA, not(containsString("message from project B")));
    assertThat(logB, not(containsString("message from project A")));
  }

  @Test
  public void closingOneServerLeavesTheOtherLogging() throws Exception {
    var rootA = tmp.newFolder("a").toPath();
    var rootB = tmp.newFolder("b").toPath();
    var serverA = newServer(0);
    var uriA = start(serverA, 0, rootA);
    var uriB = start(newServer(0), 0, rootB);
    var clientB = clientFor(uriB);
    clientFor(uriA).info("A before closing");
    awaitLogContaining(rootA, "A before closing");

    serverA.teardown();
    clientB.info("B after A closed");

    awaitLogContaining(rootB, "B after A closed");
  }

  @Test
  public void aPortThatCannotBeBoundFailsTheStart() throws Exception {
    try (var taken = new ServerSocket(0, 50, InetAddress.getLoopbackAddress())) {
      var port = taken.getLocalPort();
      var root = tmp.newFolder("taken").toPath();
      var failure =
          assertThrows(UncheckedIOException.class, () -> start(newServer(port), port, root));
      assertThat(failure.getMessage(), containsString("port " + port));
    }
  }
}
