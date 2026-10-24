package org.enso.database.audit;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Logs every statement run through the connection to the {@code Standard.Database.Connection}
 * logger at INFO, as {@code <jdbc url> - <operation>: <sql>}.
 *
 * <p>Every connection that is not cloud-audited is wrapped in one (see {@code JDBCProxy}). The
 * engine's logging configuration sets that logger to {@code warn} by default, so nothing is written
 * unless SQL logging was asked for ({@code --vm.D Standard.Database.Connection.Logger.level=info}).
 *
 * <p>Only the SQL text is logged. A prepared statement is logged with its {@code ?} placeholders,
 * never with the values bound to them, and the connection URL has any password-like values removed,
 * since either may hold a secret.
 */
public class LocalAuditedConnection extends AuditedConnection {
  public static final String LOGGER_NAME = "Standard.Database.Connection";
  private static final Logger LOGGER = LoggerFactory.getLogger(LOGGER_NAME);
  private final Logger logger;
  private final String connectionIdentifier;

  public LocalAuditedConnection(Connection underlying) {
    this(underlying, LOGGER);
  }

  /** For tests: the engine's SLF4J backend forwards to Truffle, which a unit test can't observe. */
  LocalAuditedConnection(Connection underlying, Logger logger) {
    super(underlying);
    this.logger = logger;

    String connectionUri = null;
    try {
      connectionUri = underlying.getMetaData().getURL();
    } catch (SQLException e) {
      // We ignore the exception
    }

    this.connectionIdentifier =
        connectionUri == null ? underlying.toString() : redactUrl(connectionUri);
  }

  @Override
  protected void auditQuery(String operationType, String sql) {
    try {
      logger.info("{} - {}: {}", connectionIdentifier, operationType, sql);
    } catch (RuntimeException e) {
      // Logging must never fail the statement. The engine's SLF4J backend throws, for example, on a
      // thread with no Truffle context.
    }
  }

  private static final String operationType = "transaction";

  @Override
  protected void auditTransaction(String operation) {
    auditQuery(operationType, operation);
  }

  /** The password in {@code //user:password@host}. */
  private static final Pattern USER_INFO_PASSWORD = Pattern.compile("(//[^/@:?;&]*):[^/@?;&]*@");

  /**
   * The value of a {@code key=value} property whose key looks like it names a credential, in either
   * the {@code ?a=b&c=d} or the {@code ;a=b;c=d} form.
   */
  private static final Pattern SECRET_PROPERTY =
      Pattern.compile(
          "([?&;]\\s*[^=?&;/]*(?:pass|pwd|secret|token|credential|key)[^=?&;/]*=)[^&;]*",
          Pattern.CASE_INSENSITIVE);

  /**
   * Removes credentials from a JDBC URL before it is logged.
   *
   * <p>Enso's own connectors pass credentials as connection properties, which are never logged, but
   * a URL given to {@code Generic_JDBC} (or echoed back by a driver's metadata) may carry them.
   *
   * @param url the JDBC URL
   * @return the URL with the password in any user-info part, and the value of any password-, key-,
   *     secret- or token-like property, replaced by {@code ***}
   */
  public static String redactUrl(String url) {
    var withoutUserInfo = USER_INFO_PASSWORD.matcher(url).replaceAll("$1:***@");
    return SECRET_PROPERTY.matcher(withoutUserInfo).replaceAll("$1***");
  }
}
