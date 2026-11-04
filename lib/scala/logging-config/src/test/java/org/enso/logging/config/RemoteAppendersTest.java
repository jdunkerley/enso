package org.enso.logging.config;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import com.typesafe.config.ConfigFactory;
import java.net.URI;
import java.nio.file.Path;
import org.junit.Test;
import org.slf4j.event.Level;

/**
 * The remote appenders have no built-in URL: without one in the config they must still parse, and
 * stay off (with a warning) when enabled.
 */
public class RemoteAppendersTest {
  private static final String COMMON = "log-connection-failures = false\nlog-level = info\n";

  /** Counts how often an appender asks for a real set-up. */
  private static final class NoSetup extends LoggerSetup {
    int calls = 0;

    @Override
    public boolean setupTelemetryAppender(URI logsEndpoint, boolean logConnectionFailures) {
      calls++;
      return true;
    }

    @Override
    public boolean setupOpenSearchAppender(
        Level logLevel, URI logsEndpoint, boolean logConnectionFailures) {
      calls++;
      return true;
    }

    @Override
    public LoggingServiceConfig getConfig() {
      return null;
    }

    @Override
    public boolean setupSocketAppender(Level logLevel, String hostname, int port) {
      return false;
    }

    @Override
    public boolean setupFileAppender(Level logLevel, Path logRoot, String logPrefix) {
      return false;
    }

    @Override
    public boolean setupConsoleAppender(Level logLevel) {
      return false;
    }

    @Override
    public boolean setupMemoryAppender(Level logLevel) {
      return false;
    }

    @Override
    public boolean setupNoOpAppender() {
      return true;
    }

    @Override
    public boolean setup() {
      return false;
    }

    @Override
    public boolean setup(Level logLevel) {
      return false;
    }

    @Override
    public boolean setup(
        Level logLevel, Path logRoot, String logPrefix, LoggingServiceConfig config) {
      return false;
    }

    @Override
    public boolean setupLocalSinks(
        Level logLevel, Path logRoot, String logPrefix, BaseConfig sinks) {
      return false;
    }

    @Override
    public void teardown() {}
  }

  @Test
  public void openSearchWithoutUrlParsesAndStaysOff() throws Exception {
    var appender = OpenSearchAppender.parse(ConfigFactory.parseString(COMMON + "enabled = true"));
    assertNotNull(appender);
    var setup = new NoSetup();
    assertFalse(appender.setup(Level.INFO, setup));
    assertEquals(0, setup.calls);
  }

  @Test
  public void telemetryWithoutUrlParsesAndStaysOff() throws Exception {
    var appender = TelemetryAppender.parse(ConfigFactory.parseString(COMMON + "enabled = true"));
    assertNotNull(appender);
    var setup = new NoSetup();
    assertFalse(appender.setup(Level.INFO, setup));
    assertEquals(0, setup.calls);
  }
}
