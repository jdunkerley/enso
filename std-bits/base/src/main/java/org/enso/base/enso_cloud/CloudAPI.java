package org.enso.base.enso_cloud;

import java.util.Objects;
import org.enso.base.cache.ReloadDetector;
import org.enso.base.polyglot.EnsoMeta;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class CloudAPI implements ReloadDetector.HasClearableCache {
  private static final Logger LOGGER = LoggerFactory.getLogger(CloudAPI.class);
  private static CloudAPI cached;

  private final String apiRootUri;
  private final String cloudProjectId;
  private final String cloudSessionId;

  private CloudAPI(String apiRootUri, String cloudProjectId, String cloudSessionId) {
    this.apiRootUri = apiRootUri;
    this.cloudProjectId = cloudProjectId;
    this.cloudSessionId = cloudSessionId;
    ReloadDetector.register(this);
  }

  /**
   * Obtains cached or fresh instance of CloudAPI
   *
   * @return values of cloud API to use
   */
  public static CloudAPI getInstance() {
    while (true) {
      var fresh = readFromEnv();
      synchronized (CloudAPI.class) {
        if (cached != null) {
          if (cached.equals(fresh)) {
            return cached;
          }
          cached = null;
          LOGGER.warn(
              "CloudAPI settings change detected. Dropping {}. Installing {}.", cached, fresh);
        }
      }
      EnsoMeta.callStaticModuleMethod("Standard.Base.Runtime", "gc", true);
      synchronized (CloudAPI.class) {
        if (cached == null) {
          cached = fresh;
        }
      }
    }
  }

  /**
   * Whether {@code ENSO_CLOUD_API_URL} is set. Without it no Cloud call can be made, and the audit
   * log has nowhere to go.
   */
  public boolean isConfigured() {
    return apiRootUri != null;
  }

  /**
   * Returns the URI to the root of the Cloud API.
   *
   * <p>It always ends with a slash.
   *
   * <p>There is no built-in default: the {@code ENSO_CLOUD_API_URL} environment variable must be
   * set to use any Cloud feature.
   *
   * @throws IllegalStateException if {@code ENSO_CLOUD_API_URL} is not set
   */
  public String getAPIRootURI() {
    if (apiRootUri == null) {
      throw new IllegalStateException(
          "Enso Cloud is not configured: the ENSO_CLOUD_API_URL environment variable is not set.");
    }
    return apiRootUri;
  }

  /**
   * Returns the ID of the currently opened cloud project.
   *
   * <p>When running locally, this returns {@code null}.
   */
  public String getCloudProjectId() {
    return cloudProjectId;
  }

  /**
   * Returns the session ID of the currently running cloud session.
   *
   * <p>When running locally, this returns {@code null}.
   */
  public String getCloudSessionId() {
    return cloudSessionId;
  }

  private static CloudAPI readFromEnv() {
    var envUrl =
        EnsoMeta.callStaticModuleMethod(
            "Standard.Base.System.Environment", "get", "ENSO_CLOUD_API_URL");
    String apiRootUri = null;
    if (!envUrl.isNull()) {
      var url = envUrl.asString();
      apiRootUri = url.endsWith("/") ? url : url + "/";
    }

    var projectId =
        EnsoMeta.callStaticModuleMethod(
            "Standard.Base.System.Environment", "get", "ENSO_CLOUD_PROJECT_ID");
    var cloudProjectId = projectId.isNull() ? null : projectId.asString();

    var sessionId =
        EnsoMeta.callStaticModuleMethod(
            "Standard.Base.System.Environment", "get", "ENSO_CLOUD_PROJECT_SESSION_ID");
    var cloudSessionId = sessionId.isNull() ? null : sessionId.asString();

    return new CloudAPI(apiRootUri, cloudProjectId, cloudSessionId);
  }

  @Override
  public int hashCode() {
    int hash = 3;
    hash = 29 * hash + Objects.hashCode(this.apiRootUri);
    hash = 29 * hash + Objects.hashCode(this.cloudProjectId);
    hash = 29 * hash + Objects.hashCode(this.cloudSessionId);
    return hash;
  }

  @Override
  public boolean equals(Object obj) {
    if (this == obj) {
      return true;
    }
    if (obj == null) {
      return false;
    }
    if (getClass() != obj.getClass()) {
      return false;
    }
    final CloudAPI other = (CloudAPI) obj;
    if (!Objects.equals(this.apiRootUri, other.apiRootUri)) {
      return false;
    }
    if (!Objects.equals(this.cloudProjectId, other.cloudProjectId)) {
      return false;
    }
    return Objects.equals(this.cloudSessionId, other.cloudSessionId);
  }

  @Override
  public String toString() {
    return "CloudAPI{"
        + "apiRootUri="
        + apiRootUri
        + ", cloudProjectId="
        + cloudProjectId
        + ", cloudSessionId="
        + cloudSessionId
        + '}';
  }

  @Override
  public void clearCache() {
    cached = null;
  }
}
