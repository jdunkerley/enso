package org.enso.database.audit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.enso.base.enso_cloud.EnsoHideableValue;
import org.enso.database.JDBCProxy;
import org.junit.Test;
import org.slf4j.Marker;
import org.slf4j.event.Level;
import org.slf4j.helpers.LegacyAbstractLogger;
import org.slf4j.helpers.MessageFormatter;

/**
 * Every connection {@link JDBCProxy} opens is wrapped in one {@link LocalAuditedConnection}, data
 * link or not, which logs each statement at INFO and never the values bound to a prepared
 * statement.
 */
public class LocalAuditedConnectionTest {
  private static final String URL = "jdbc:sqlite::memory:";
  private static final String SECRET_VALUE = "s3cr3t-bound-value";

  /** Records what is logged at or above {@code threshold}, like the engine's level filter. */
  private static final class CapturingLogger extends LegacyAbstractLogger {
    final List<String> infoMessages = new ArrayList<>();
    final List<String> allMessages = new ArrayList<>();
    private final Level threshold;

    CapturingLogger(Level threshold) {
      this.threshold = threshold;
      this.name = LocalAuditedConnection.LOGGER_NAME;
    }

    private boolean enabled(Level level) {
      return level.toInt() >= threshold.toInt();
    }

    @Override
    public boolean isTraceEnabled() {
      return enabled(Level.TRACE);
    }

    @Override
    public boolean isDebugEnabled() {
      return enabled(Level.DEBUG);
    }

    @Override
    public boolean isInfoEnabled() {
      return enabled(Level.INFO);
    }

    @Override
    public boolean isWarnEnabled() {
      return enabled(Level.WARN);
    }

    @Override
    public boolean isErrorEnabled() {
      return enabled(Level.ERROR);
    }

    @Override
    protected String getFullyQualifiedCallerName() {
      return null;
    }

    @Override
    protected void handleNormalizedLoggingCall(
        Level level, Marker marker, String format, Object[] args, Throwable throwable) {
      var message = MessageFormatter.basicArrayFormat(format, args);
      allMessages.add(message);
      if (level == Level.INFO) {
        infoMessages.add(message);
      }
    }
  }

  private static Connection rawConnection() throws Exception {
    return DriverManager.getConnection(URL);
  }

  private static void runStatements(Connection connection) throws Exception {
    try (var statement = connection.createStatement()) {
      statement.executeUpdate("CREATE TABLE t (a TEXT)");
    }
    connection.setAutoCommit(false);
    try (var insert = connection.prepareStatement("INSERT INTO t VALUES (?)")) {
      insert.setString(1, SECRET_VALUE);
      insert.executeUpdate();
    }
    connection.commit();
    connection.setAutoCommit(true);
    try (var select = connection.prepareStatement("SELECT a FROM t WHERE a = ?")) {
      select.setString(1, SECRET_VALUE);
      try (var rs = select.executeQuery()) {
        assertTrue(rs.next());
        assertEquals(SECRET_VALUE, rs.getString(1));
      }
    }
  }

  private static final List<String> EXPECTED =
      List.of(
          URL + " - update: CREATE TABLE t (a TEXT)",
          URL + " - transaction: setAutoCommit false",
          URL + " - update: INSERT INTO t VALUES (?)",
          URL + " - transaction: commit",
          URL + " - transaction: setAutoCommit true",
          URL + " - query: SELECT a FROM t WHERE a = ?");

  @Test
  public void logsEachStatementOnceAtInfo() throws Exception {
    var logger = new CapturingLogger(Level.INFO);
    try (var connection = new LocalAuditedConnection(rawConnection(), logger)) {
      runStatements(connection);
    }
    assertEquals(EXPECTED, logger.infoMessages);
    assertEquals(EXPECTED, logger.allMessages);
  }

  @Test
  public void boundValuesAreNeverLogged() throws Exception {
    var logger = new CapturingLogger(Level.TRACE);
    try (var connection = new LocalAuditedConnection(rawConnection(), logger)) {
      runStatements(connection);
    }
    assertFalse(logger.allMessages.isEmpty());
    for (var message : logger.allMessages) {
      assertFalse(message, message.contains(SECRET_VALUE));
    }
  }

  @Test
  public void nothingIsLoggedAtTheDefaultWarnLevel() throws Exception {
    var logger = new CapturingLogger(Level.WARN);
    try (var connection = new LocalAuditedConnection(rawConnection(), logger)) {
      runStatements(connection);
    }
    assertTrue(logger.allMessages.toString(), logger.allMessages.isEmpty());
  }

  @Test
  public void aPlainConnectionIsWrappedOnce() throws Exception {
    try (var connection =
        JDBCProxy.getConnectionWithCatalogSchema(URL, Map.of(), null, null, null)) {
      assertWrappedOnce(connection);
    }
  }

  @Test
  public void aDataLinkConnectionIsWrappedOnce() throws Exception {
    var properties = Map.of(JDBCProxy.AUDITED_KEY, plain("local"));
    try (var connection =
        JDBCProxy.getConnectionWithCatalogSchema(URL, properties, null, null, null)) {
      assertWrappedOnce(connection);
    }
  }

  @Test
  public void anInitScriptRunsOnTheWrappedConnection() throws Exception {
    // This also logs through the engine's SLF4J backend, which throws here (no Truffle context):
    // the statement must still run.
    try (var connection =
        JDBCProxy.getConnectionWithCatalogSchema(
            URL, Map.of(), null, null, "CREATE TABLE created_by_init (a INTEGER)")) {
      assertWrappedOnce(connection);
      try (var statement = connection.createStatement();
          var rs = statement.executeQuery("SELECT count(*) FROM created_by_init")) {
        assertTrue(rs.next());
      }
    }
  }

  private static void assertWrappedOnce(Connection connection) throws Exception {
    assertTrue(connection.getClass().getName(), connection instanceof LocalAuditedConnection);
    var underlying = ((LocalAuditedConnection) connection).underlying;
    assertFalse(underlying.getClass().getName(), underlying instanceof AuditedConnection);
    // Driver-specific code (e.g. DuckDB's appender) reaches the driver's class through `unwrap`.
    assertTrue(connection.isWrapperFor(org.sqlite.SQLiteConnection.class));
    var unwrapped = connection.unwrap(org.sqlite.SQLiteConnection.class);
    assertTrue(unwrapped.getClass().getName(), unwrapped instanceof org.sqlite.SQLiteConnection);
  }

  @Test
  public void quotingIsTheDriversOwn() throws Exception {
    try (var raw = rawConnection();
        var wrapped = new LocalAuditedConnection(rawConnection(), new CapturingLogger(Level.WARN));
        var rawStatement = raw.createStatement();
        var wrappedStatement = wrapped.createStatement()) {
      assertEquals(
          rawStatement.enquoteIdentifier("a b", true),
          wrappedStatement.enquoteIdentifier("a b", true));
      assertEquals(rawStatement.enquoteLiteral("it's"), wrappedStatement.enquoteLiteral("it's"));
    }
  }

  @Test
  public void redactUrlKeepsAnOrdinaryUrl() {
    for (var url :
        List.of(
            "jdbc:sqlite::memory:",
            "jdbc:sqlite:C:/Users/me/data.db",
            "jdbc:duckdb:/home/me/my-keys.duckdb",
            "jdbc:postgresql://localhost:5432/db",
            "jdbc:postgresql://localhost:5432/db?sslmode=require&user=me",
            "jdbc:sqlserver://host:1433;databaseName=db;encrypt=true",
            "jdbc:snowflake://acct.snowflakecomputing.com")) {
      assertEquals(url, LocalAuditedConnection.redactUrl(url));
    }
  }

  @Test
  public void redactUrlRemovesCredentials() {
    assertEquals(
        "jdbc:postgresql://me:***@localhost:5432/db",
        LocalAuditedConnection.redactUrl("jdbc:postgresql://me:hunter2@localhost:5432/db"));
    assertEquals(
        "jdbc:postgresql://localhost/db?user=me&password=***&ssl=true",
        LocalAuditedConnection.redactUrl(
            "jdbc:postgresql://localhost/db?user=me&password=hunter2&ssl=true"));
    assertEquals(
        "jdbc:sqlserver://host:1433;user=me;Password=***;encrypt=true",
        LocalAuditedConnection.redactUrl(
            "jdbc:sqlserver://host:1433;user=me;Password=hunter2;encrypt=true"));
    assertEquals("jdbc:h2:~/db;PWD=***", LocalAuditedConnection.redactUrl("jdbc:h2:~/db;PWD=x"));
    assertEquals(
        "jdbc:foo://h/db?accessKey=***&secretKey=***&token=***",
        LocalAuditedConnection.redactUrl("jdbc:foo://h/db?accessKey=AKIA&secretKey=abc&token=xyz"));
  }

  private static EnsoHideableValue plain(String text) {
    return new EnsoHideableValue() {
      @Override
      public String value_type() {
        return EnsoHideableValue.PLAIN_TYPE;
      }

      @Override
      public String text_value() {
        return text;
      }

      @Override
      public List<EnsoHideableValue> children() {
        return List.of();
      }
    };
  }
}
