package org.enso.logging.config;

import com.typesafe.config.Config;
import java.net.URI;
import org.slf4j.event.Level;

public final class OpenSearchAppender extends Appender {
  public static final String appenderName = "opensearch";
  private final String logsUri;
  private final boolean logConnectionFailures;
  private final Level maxLogLevel;
  private final boolean enabled;

  public OpenSearchAppender(
      String apiUri, boolean logConnectionFailures, Level maxLogLevel, boolean enabled) {
    this.logsUri = apiUri == null || apiUri.isBlank() ? null : apiUri + "/logs";
    this.logConnectionFailures = logConnectionFailures;
    this.maxLogLevel = maxLogLevel;
    this.enabled = enabled;
  }

  public static Appender parse(Config config) throws MissingConfigurationField {
    String uri = config.hasPath("uri") ? config.getString("uri") : null;
    boolean logConnectionFailures = config.getBoolean("log-connection-failures");
    String logLevel = config.getString("log-level");
    Level maxLogLevel = Level.valueOf(logLevel.toUpperCase());
    boolean enabled = config.getBoolean("enabled");
    return new OpenSearchAppender(uri, logConnectionFailures, maxLogLevel, enabled);
  }

  @Override
  public String getName() {
    return appenderName;
  }

  @Override
  public boolean setup(Level logLevel, LoggerSetup loggerSetup) {
    if (enabled && logsUri == null) {
      System.err.println(
          "OpenSearch appender is enabled but has no URL: set ENSO_CLOUD_API_URL. It stays off.");
      return false;
    }
    var maxLogLevelInt = Math.min(logLevel.toInt(), maxLogLevel.toInt());
    return enabled
        && loggerSetup.setupOpenSearchAppender(
            Level.intToLevel(maxLogLevelInt), URI.create(logsUri), logConnectionFailures);
  }
}
