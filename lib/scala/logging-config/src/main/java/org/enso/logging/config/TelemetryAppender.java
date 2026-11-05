package org.enso.logging.config;

import com.typesafe.config.Config;
import java.net.URI;
import org.slf4j.event.Level;

/** Config for the appender that sends telemetry events to the Enso Cloud logs endpoint. */
public final class TelemetryAppender extends Appender {
  public static final String appenderName = "telemetry";
  private final String logsUri;
  private final boolean logConnectionFailures;
  private final boolean enabled;

  public TelemetryAppender(String apiUri, boolean logConnectionFailures, boolean enabled) {
    assert apiUri == null || !apiUri.endsWith("/");
    this.logsUri = apiUri == null || apiUri.isBlank() ? null : apiUri + "/logs";
    this.logConnectionFailures = logConnectionFailures;
    this.enabled = enabled;
  }

  public static Appender parse(Config config) throws MissingConfigurationField {
    String uri = config.hasPath("uri") ? config.getString("uri") : null;
    boolean logConnectionFailures = config.getBoolean("log-connection-failures");
    boolean enabled = config.getBoolean("enabled");
    return new TelemetryAppender(uri, logConnectionFailures, enabled);
  }

  @Override
  public String getName() {
    return appenderName;
  }

  @Override
  public boolean setup(Level logLevel, LoggerSetup loggerSetup) {
    if (enabled && logsUri == null) {
      System.err.println(
          "Telemetry appender is enabled but has no URL: set ENSO_CLOUD_API_URL. It stays off.");
      return false;
    }
    return enabled
        && loggerSetup.setupTelemetryAppender(URI.create(logsUri), logConnectionFailures);
  }
}
