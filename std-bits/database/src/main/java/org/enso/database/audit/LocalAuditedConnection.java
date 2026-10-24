package org.enso.database.audit;

import java.sql.Connection;
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
 * While INFO is off, a statement costs one {@code isInfoEnabled} check and nothing is built.
 *
 * <p>Only the SQL text is logged. A prepared statement is logged with its {@code ?} placeholders,
 * never with the values bound to them. The connection URL goes through {@link #redactUrl}, which
 * masks the common ways of putting a password in a URL; it is pattern matching, so it can't be
 * complete.
 *
 * <p>Logging never breaks the connection: the URL is only looked up when the first line is written,
 * and any failure there or in the logger itself is ignored.
 */
public class LocalAuditedConnection extends AuditedConnection {
  public static final String LOGGER_NAME = "Standard.Database.Connection";

  /** The label used when the connection's URL can't be read. */
  static final String UNKNOWN_CONNECTION = "<unknown connection>";

  private static final Logger LOGGER = LoggerFactory.getLogger(LOGGER_NAME);
  private final Logger logger;

  /** The redacted URL, worked out on the first line actually logged. */
  private String connectionIdentifier = null;

  public LocalAuditedConnection(Connection underlying) {
    this(underlying, LOGGER);
  }

  /** For tests: the engine's SLF4J backend forwards to Truffle, which a unit test can't observe. */
  LocalAuditedConnection(Connection underlying, Logger logger) {
    super(underlying);
    this.logger = logger;
  }

  @Override
  boolean isAuditEnabled() {
    try {
      return logger.isInfoEnabled();
    } catch (RuntimeException e) {
      // The engine's SLF4J backend throws, for example, on a thread with no Truffle context.
      return false;
    }
  }

  @Override
  protected void auditQuery(String operationType, String sql) {
    if (!isAuditEnabled()) {
      return;
    }
    var identifier = connectionIdentifier();
    try {
      logger.info("{} - {}: {}", identifier, operationType, sql);
    } catch (RuntimeException e) {
      // Logging must never fail the statement.
    }
  }

  private static final String operationType = "transaction";

  @Override
  protected void auditTransaction(String operation) {
    auditQuery(operationType, operation);
  }

  private String connectionIdentifier() {
    if (connectionIdentifier == null) {
      connectionIdentifier = describe(underlying);
    }
    return connectionIdentifier;
  }

  /**
   * The redacted URL of the connection, or {@link #UNKNOWN_CONNECTION} if it can't be read. Never
   * throws: drivers that don't implement metadata may throw anything here.
   */
  static String describe(Connection connection) {
    try {
      var url = connection.getMetaData().getURL();
      return url == null ? UNKNOWN_CONNECTION : redactUrl(url);
    } catch (Exception | LinkageError e) {
      return UNKNOWN_CONNECTION;
    }
  }

  /**
   * The password in {@code //user:password@host}. The password runs to the last {@code @} that is
   * followed by a host (so it may itself contain {@code @} or {@code /}), but not across {@code ?}
   * or {@code ;}, where the URL's properties start.
   */
  private static final Pattern USER_INFO_PASSWORD =
      Pattern.compile("(//[^/@:?;&,()]*):[^?;]*@(?=[^@/?;]*(?:[/?;]|$))");

  /**
   * The password in the Oracle thin form {@code :user/password@host} (or {@code @//host}). It runs
   * to the last {@code @} in the URL.
   */
  private static final Pattern SLASH_USER_PASSWORD = Pattern.compile("(:[^:/@;?&,()=\\s]+)/.*@");

  /**
   * The value of a {@code key=value} property whose key looks like it names a credential, in the
   * {@code ?a=b&c=d}, {@code ;a=b;c=d}, {@code /a=b,c=d} (Teradata) or {@code (a=b,c=d)} (MySQL)
   * form. A SQL Server braced value ({@code {a;b}}, with {@code }}} for a literal brace) is masked
   * whole.
   */
  private static final Pattern SECRET_PROPERTY =
      Pattern.compile(
          "([?&;,(/]\\s*[^=?&;,()/]*(?:pass|pwd|secret|token|credential|key)[^=?&;,()/]*=)"
              + "(?:\\{(?:[^}]|\\}\\})*\\}|[^&;,)]*)",
          Pattern.CASE_INSENSITIVE);

  /**
   * Removes credentials from a JDBC URL before it is logged.
   *
   * <p>Enso's own connectors pass credentials as connection properties, which are never logged, but
   * a URL given to {@code Generic_JDBC} (or echoed back by a driver's metadata) may carry them. The
   * patterns err on the side of masking: a harmless property whose name contains "key" is masked
   * too.
   *
   * @param url the JDBC URL
   * @return the URL with the password in a user-info or Oracle {@code user/password@} part, and the
   *     value of any password-, key-, secret- or token-like property, replaced by {@code ***}
   */
  public static String redactUrl(String url) {
    var result = USER_INFO_PASSWORD.matcher(url).replaceAll("$1:***@");
    result = SLASH_USER_PASSWORD.matcher(result).replaceAll("$1/***@");
    return SECRET_PROPERTY.matcher(result).replaceAll("$1***");
  }
}
