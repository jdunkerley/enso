package org.enso.logging.config;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import com.typesafe.config.Config;
import com.typesafe.config.ConfigFactory;
import java.io.File;
import java.util.Map;
import org.junit.After;
import org.junit.Test;
import org.slf4j.event.Level;

/**
 * The per-logger levels, and the IDE's way of turning one up for a single engine: the system
 * property {@code <logger>.Logger.level}, which the runner sets from {@code --vm.D} before logging
 * is set up.
 */
public class LoggersLevelsTest {
  private static final String SQL = "Standard.Database.Connection";
  private static final String PROGRESS = "Standard.Base.Logging.Progress";

  @After
  public void clearProperties() {
    System.clearProperty(SQL + ".Logger.level");
    System.clearProperty(PROGRESS + ".Logger.level");
  }

  /** The engine's own `logger { … }` block, as the configs below write it. */
  private static Config loggerBlock() {
    return ConfigFactory.parseString(
        PROGRESS + " = error\n" + SQL + " = warn\n" + "akka = error\n");
  }

  @Test
  public void dottedKeysKeepTheirWholeName() {
    var levels = LoggersLevels.parse(loggerBlock());
    assertEquals(Level.ERROR, levelOf(levels, PROGRESS));
    assertEquals(Level.WARN, levelOf(levels, SQL));
  }

  @Test
  public void aSystemPropertyOverridesTheConfiguredLevel() {
    System.setProperty(SQL + ".Logger.level", "info");
    System.setProperty(PROGRESS + ".Logger.level", "debug");
    var levels = LoggersLevels.parse(loggerBlock());
    assertEquals(Level.INFO, levelOf(levels, SQL));
    assertEquals(Level.DEBUG, levelOf(levels, PROGRESS));
  }

  /**
   * `ApplicationFilter` (logging-service-logback) gives an event the level of the first entry whose
   * name its logger's name starts with. The overrides come first, so they win for the logger and
   * its children (`Progress.run` logs under `Standard.Base.Logging.Progress.<handle>`).
   */
  @Test
  public void anOverrideIsTheFirstMatchForTheLoggerAndItsChildren() {
    System.setProperty(PROGRESS + ".Logger.level", "debug");
    var levels = LoggersLevels.parse(loggerBlock());
    assertEquals(Level.DEBUG, firstMatch(levels, PROGRESS + ".JDBC_Connection.Execute query"));
    assertEquals(Level.WARN, firstMatch(levels, SQL));
  }

  @Test
  public void onlyTheNamedLoggerIsOverridden() {
    System.setProperty(PROGRESS + ".Logger.level", "debug");
    var levels = LoggersLevels.parse(loggerBlock());
    assertEquals(Level.WARN, levelOf(levels, SQL));
    assertEquals(Level.ERROR, levelOf(levels, "akka"));
  }

  /** The engine's configs: SQL queries and progress timings are off unless turned up. */
  @Test
  public void theEngineConfigsKeepSqlAndTimingsOff() {
    for (var resource :
        new String[] {
          "engine/runner/src/main/resources/application.conf",
          "engine/language-server/src/main/resources/application-ls.conf"
        }) {
      var file = new File(repositoryRoot(), resource);
      var loggers =
          ConfigFactory.parseFile(file).resolve().getConfig("logging-service").getConfig("logger");
      var levels = LoggersLevels.parse(loggers);
      assertEquals(resource, Level.WARN, levelOf(levels, SQL));
      assertEquals(resource, Level.ERROR, levelOf(levels, PROGRESS));
    }
  }

  private static Level levelOf(LoggersLevels levels, String logger) {
    for (Map.Entry<String, Level> entry : levels.entrySet()) {
      if (entry.getKey().equals(logger)) return entry.getValue();
    }
    return null;
  }

  private static Level firstMatch(LoggersLevels levels, String eventLogger) {
    for (Map.Entry<String, Level> entry : levels.entrySet()) {
      if (eventLogger.startsWith(entry.getKey())) return entry.getValue();
    }
    return null;
  }

  private static File repositoryRoot() {
    var dir = new File("").getAbsoluteFile();
    while (dir != null && !new File(dir, "build.sbt").isFile()) dir = dir.getParentFile();
    assertNotNull("The repository root (with build.sbt) is above the working directory", dir);
    return dir;
  }
}
