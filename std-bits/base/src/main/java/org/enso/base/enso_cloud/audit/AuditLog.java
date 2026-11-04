package org.enso.base.enso_cloud.audit;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import org.enso.base.enso_cloud.CloudAPI;

/**
 * The high-level API for logging audit events.
 *
 * <p>The messages are sent on a single background thread in batches, but also as soon as possible.
 * That means that we are never waiting for more messages to be batched to avoid delaying logs.
 * However, if sending the previous batch took enough time that many messages have been scheduled in
 * the meantime, all waiting messages (up to some limit) will be sent in a single request.
 *
 * <p>Without a Cloud API URL ({@code ENSO_CLOUD_API_URL}), there is nowhere to send events, so both
 * methods do nothing.
 */
public final class AuditLog {
  /** Schedules the log message to be sent in the next batch, and returns immediately. */
  public static void logAsync(String type, String message, ObjectNode metadata) {
    if (!CloudAPI.getInstance().isConfigured()) {
      return;
    }
    var event = new AuditLogMessage(type, message, metadata);
    AuditLogApiAccess.INSTANCE.logWithoutConfirmation(event);
  }

  /** Schedules the log message to be sent in the next batch, and waits until it has been sent. */
  public static void logSynchronously(String type, String message, ObjectNode metadata) {
    if (!CloudAPI.getInstance().isConfigured()) {
      return;
    }
    var event = new AuditLogMessage(type, message, metadata);
    Future<Void> future = AuditLogApiAccess.INSTANCE.logWithConfirmation(event);
    try {
      future.get();
    } catch (ExecutionException | InterruptedException e) {
      throw new AuditLogError("Failed to send log message: " + e, e);
    }
  }

  public static class AuditLogError extends RuntimeException {
    public AuditLogError(String message, Throwable cause) {
      super(message, cause);
    }
  }

  public static void resetCache() {
    AuditLogApiAccess.INSTANCE.resetCache();
  }
}
