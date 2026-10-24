package org.enso.database;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.ServiceLoader;
import org.enso.base.enso_cloud.EnsoHideableValue;
import org.enso.base.enso_cloud.EnsoSecretAccessDenied;
import org.enso.base.enso_cloud.EnsoSecretHelper;
import org.enso.database.audit.CloudAuditedConnection;
import org.enso.database.audit.LocalAuditedConnection;

/**
 * A helper class for accessing the JDBC components.
 *
 * <p>This class is necessary because the JDBC depends on the caller's classloader to determine
 * which drivers are available and so if it is called directly from Enso it does not see the correct
 * classloaders, thus not detecting the proper drivers.
 */
public final class JDBCProxy {
  /**
   * A helper method that lists registered JDBC drivers.
   *
   * <p>Can be used for debugging.
   *
   * @return an array of JDBC drivers that are currently registered
   */
  public static Object[] getDrivers() {
    return DriverManager.drivers().toArray();
  }

  /**
   * Tries to create a new connection using the JDBC DriverManager.
   *
   * <p>It delegates directly to {@code DriverManager.getConnection}. That is needed because if that
   * method is called directly from Enso, the JDBC drivers are not detected correctly.
   *
   * @param url database url to connect to, starting with `jdbc:`
   * @param properties configuration for the connection
   * @param catalog the catalog to set on the connection, or null to not set it
   * @param schema the schema to set on the connection, or null to not set it
   * @param initScript an initialization script to run when creating a database connection
   * @return a connection
   */
  public static Connection getConnectionWithCatalogSchema(
      String url,
      Map<String, EnsoHideableValue> properties,
      String catalog,
      String schema,
      String initScript)
      throws SQLException {
    // We need to manually register all the drivers because the DriverManager is not able
    // to correctly use our class loader, it only delegates to the platform class loader when
    // loading the java.sql.Driver service.
    var sl = ServiceLoader.load(java.sql.Driver.class, JDBCProxy.class.getClassLoader());
    for (var driver : sl) {
      DriverManager.registerDriver(driver);
    }

    PartitionedProperties partitionedProperties = PartitionedProperties.parse(properties);
    var audited = partitionedProperties.audited();
    if (audited != null && !"local".equals(audited) && !"cloud".equals(audited)) {
      throw new IllegalArgumentException("Unknown audit mode: " + audited);
    }

    var rawConnection =
        EnsoSecretHelper.getJDBCConnection(url, partitionedProperties.jdbcProperties);
    try {
      if (catalog != null && !catalog.isEmpty()) {
        rawConnection.setCatalog(catalog);
      }
      if (schema != null && !schema.isEmpty()) {
        rawConnection.setSchema(schema);
      }

      if ("cloud".equals(audited)) {
        runInitScript(rawConnection, initScript);
        return new CloudAuditedConnection(rawConnection, partitionedProperties.getRelatedAssetId());
      }

      var connection = withQueryLogging(rawConnection);
      runInitScript(connection, initScript);
      return connection;
    } catch (Throwable e) {
      // Don't leak the connection when setting it up fails.
      try {
        rawConnection.close();
      } catch (Throwable closeError) {
        e.addSuppressed(closeError);
      }
      throw e;
    }
  }

  /**
   * Every connection that is not cloud-audited logs its statements locally, so that SQL logging
   * (the `Standard.Database.Connection` logger at INFO) covers a plain `Database.connect` as well
   * as a data link. Code that needs the driver's own connection class must `unwrap` it (see
   * `DuckDBUtils`).
   *
   * <p>Logging must never break a connection: if the wrapper can't be created, the connection is
   * returned as it is.
   */
  private static Connection withQueryLogging(Connection rawConnection) {
    try {
      return new LocalAuditedConnection(rawConnection);
    } catch (RuntimeException | LinkageError e) {
      return rawConnection;
    }
  }

  private static void runInitScript(Connection connection, String initScript) throws SQLException {
    if (initScript != null && !initScript.isEmpty()) {
      try (var statement = connection.createStatement()) {
        statement.executeUpdate(initScript);
      }
    }
  }

  private static final String ENSO_PROPERTY_PREFIX = "enso.internal.";
  public static final String AUDITED_KEY = ENSO_PROPERTY_PREFIX + "audit";
  public static final String RELATED_ASSET_ID_KEY = ENSO_PROPERTY_PREFIX + "relatedAssetId";

  private record PartitionedProperties(
      Map<String, String> ensoProperties, Map<String, EnsoHideableValue> jdbcProperties) {
    public static PartitionedProperties parse(Map<String, EnsoHideableValue> properties) {
      Map<String, EnsoHideableValue> jdbcProperties = new HashMap<>();
      HashMap<String, String> ensoProperties = new HashMap<>();

      for (var key : properties.keySet()) {
        if (key.startsWith(ENSO_PROPERTY_PREFIX)) {
          try {
            ensoProperties.put(key, EnsoHideableValue.safeResolve(properties.get(key)));
          } catch (EnsoSecretAccessDenied e) {
            throw new IllegalStateException(
                "Internal Enso property " + key + " should not contain secrets.");
          }
        } else {
          jdbcProperties.put(key, properties.get(key));
        }
      }

      return new PartitionedProperties(ensoProperties, jdbcProperties);
    }

    public String audited() {
      return ensoProperties.get(AUDITED_KEY);
    }

    public String getRelatedAssetId() {
      return ensoProperties.get(RELATED_ASSET_ID_KEY);
    }
  }
}
