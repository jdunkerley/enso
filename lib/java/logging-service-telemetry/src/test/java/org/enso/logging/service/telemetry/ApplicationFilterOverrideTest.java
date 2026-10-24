package org.enso.logging.service.telemetry;

import static org.junit.Assert.assertEquals;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.spi.FilterReply;
import com.typesafe.config.ConfigFactory;
import org.enso.logging.config.LoggersLevels;
import org.enso.logging.service.logback.ApplicationFilter;
import org.junit.After;
import org.junit.Test;

/**
 * The real {@link ApplicationFilter} with a per-logger override, as the IDE's Engine logs settings
 * pass one ({@code --vm.D <logger>.Logger.level=<level>}): the override decides for the logger and
 * its children, and the config decides for every other logger. (It lives here because this project
 * has JUnit and depends on logging-service-logback.)
 */
public class ApplicationFilterOverrideTest {
  private static final String PROGRESS = "Standard.Base.Logging.Progress";
  private static final String SQL = "Standard.Database.Connection";

  @After
  public void clearProperties() {
    System.clearProperty(PROGRESS + ".Logger.level");
    System.clearProperty(SQL + ".Logger.level");
  }

  /** The filter the engine builds: the configs' levels, and the file's INFO threshold. */
  private static ApplicationFilter filter() {
    var config = ConfigFactory.parseString(PROGRESS + " = error\n" + SQL + " = warn\n");
    return (ApplicationFilter)
        ApplicationFilter.fromLoggers(
            LoggersLevels.parse(config), org.slf4j.event.Level.INFO, "enso");
  }

  private static FilterReply decide(ApplicationFilter filter, String logger, Level level) {
    var event = new LoggingEvent();
    event.setLoggerName(logger);
    event.setLevel(level);
    event.setMessage("message");
    return filter.decide(event);
  }

  @Test
  public void withoutAnOverrideTheConfigDecides() {
    var filter = filter();
    assertEquals(FilterReply.DENY, decide(filter, PROGRESS + ".JDBC_Connection.x", Level.DEBUG));
    assertEquals(FilterReply.DENY, decide(filter, SQL, Level.INFO));
    assertEquals(FilterReply.NEUTRAL, decide(filter, SQL, Level.WARN));
  }

  @Test
  public void anOverrideLetsTheLoggerAndItsChildrenThrough() {
    System.setProperty(PROGRESS + ".Logger.level", "debug");
    var filter = filter();
    assertEquals(FilterReply.NEUTRAL, decide(filter, PROGRESS, Level.DEBUG));
    assertEquals(
        FilterReply.NEUTRAL,
        decide(filter, PROGRESS + ".JDBC_Connection.[SQLite] SELECT 1", Level.DEBUG));
    // Below the override's level still does not pass.
    assertEquals(FilterReply.DENY, decide(filter, PROGRESS + ".Table.set", Level.TRACE));
  }

  @Test
  public void anOverrideChangesOnlyItsOwnLogger() {
    System.setProperty(SQL + ".Logger.level", "info");
    var filter = filter();
    assertEquals(FilterReply.NEUTRAL, decide(filter, SQL, Level.INFO));
    assertEquals(FilterReply.DENY, decide(filter, PROGRESS + ".JDBC_Connection.x", Level.DEBUG));
    // Any other logger keeps the INFO threshold.
    assertEquals(FilterReply.DENY, decide(filter, "Standard.Table.Table", Level.DEBUG));
    assertEquals(FilterReply.NEUTRAL, decide(filter, "Standard.Table.Table", Level.INFO));
  }
}
