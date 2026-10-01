package org.enso.logging.service.logback;

import ch.qos.logback.classic.LoggerContext;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.util.UUID;
import org.enso.logging.config.BaseConfig;
import org.enso.logging.service.LoggingService;
import org.slf4j.MDC;
import org.slf4j.event.Level;

class LoggingServer extends LoggingService<URI> {

  private int port;
  private SocketServer logServer;

  public LoggingServer(int port) {
    this.port = port;
    this.logServer = null;
  }

  /**
   * Binds the server and starts accepting log events from other components.
   *
   * @return the URI the server listens on, carrying the port actually bound (see {@link
   *     SocketServer#bind()})
   * @throws java.io.UncheckedIOException if the port cannot be bound; nothing is left running
   */
  public URI start(Level level, Path path, String prefix, BaseConfig config) {
    var lc = new LoggerContext();
    // Since logback 1.5 each context carries its own MDC adapter, which SLF4J's
    // provider installs only on the default context. Without one, any event
    // logged through this context fails as soon as an appender reads the MDC.
    // Share the global adapter, which is what every context used before 1.5.
    lc.setMDCAdapter(MDC.getMDCAdapter());

    var server = new SocketServer(lc, port);
    int boundPort;
    try {
      // Note [Logging Server Binds Before It Starts] in SocketServer.
      boundPort = server.bind();
    } catch (IOException e) {
      server.close();
      throw new UncheckedIOException(
          "Cannot start the logging server on port " + port + ": " + e.getMessage(), e);
    }
    try {
      logServer = server;
      logServer.start();
      LogbackSetup.forContext(lc, config).setupLocalSinks(level, path, prefix, config);
      return new URI(null, null, "localhost", boundPort, null, null, null);
    } catch (URISyntaxException e) {
      throw new RuntimeException(e);
    }
  }

  public boolean isSetup() {
    return logServer != null;
  }

  @Override
  public void teardown(UUID projectId) {
    if (logServer != null) {
      logServer.closeProject(projectId);
    }
  }

  @Override
  public void teardown() {
    if (logServer != null) {
      logServer.close();
    }
  }
}
