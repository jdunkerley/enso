package org.enso.logging.service;

import java.net.URI;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.enso.logger.masking.Masking;
import org.enso.logging.config.LoggerSetup;
import org.enso.logging.config.MissingConfigurationField;
import org.enso.logging.config.SocketAppender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.Level;
import scala.Option;
import scala.Unit$;
import scala.concurrent.Await;
import scala.concurrent.ExecutionContext;
import scala.concurrent.Future;
import scala.concurrent.Promise;
import scala.concurrent.Promise$;
import scala.concurrent.duration.Duration$;

/**
 * Base class for any Enso service that needs to setup its logging.
 *
 * <p>Note: if this looks ugly and not very Java-friendly, it's because it is. It's a 1:1
 * translation from Scala.
 */
public abstract class LoggingSetupHelper {

  public LoggingSetupHelper(ExecutionContext ec) {
    this.ec = ec;
  }

  private ExecutionContext ec;

  private static final Logger logger = LoggerFactory.getLogger(LoggingSetupHelper.class);

  protected abstract Level defaultLogLevel();

  protected abstract String logFileSuffix();

  protected abstract Path logPath();

  public Future<Option<URI>> loggingServiceEndpoint() {
    return loggingServiceEndpointPromise.future();
  }

  private Promise<Option<URI>> loggingServiceEndpointPromise = Promise$.MODULE$.apply();

  /**
   * Initialize logging to console prior to establishing logging. Some logs may be added while
   * inferring the parameters of logging infrastructure, leading to catch-22 situations.
   */
  public void initLogger() {
    LoggerSetup.get().setupNoOpAppender();
  }

  public void setupFallback() {
    LoggerSetup.get().setupConsoleAppender(defaultLogLevel());
  }

  /**
   * Starts a logging server, if necessary, that accepts logs from different components. Once
   * started, logs in this service are being setup to be forwarded to that logging server.
   *
   * <p>If the server cannot be started, e.g. because its port is taken, this service logs locally
   * instead, to the sinks the server would have used, and says so in a warning. See Note [Each
   * Process Hosts Its Own Logging Server].
   *
   * @param logLevel maximal level of log events to be forwarded
   * @param logMasking true if masking of sensitive data should be applied to all log messages
   */
  public void setup(Level logLevel, boolean logMasking) throws MissingConfigurationField {
    initLogger();
    var loggerSetup = LoggerSetup.get();
    var config = loggerSetup.getConfig();
    if (config.loggingServerNeedsBoot()) {
      int requestedPort = config.getServer().port();
      // The callback runs on another thread; the log file's location depends on the MDC.
      var mdcContext = MDC.getCopyOfContextMap();
      LoggingServiceManager.setupServer(
              logLevel, requestedPort, logPath(), logFileSuffix(), config.getServer(), ec)
          .onComplete(
              (result) -> {
                if (mdcContext != null) {
                  MDC.setContextMap(mdcContext);
                }
                try {
                  if (result.isFailure()) {
                    fallBackToLocalLogging(
                        logLevel,
                        logMasking,
                        loggerSetup,
                        "Could not start the logging server on port " + requestedPort,
                        result.failed().get());
                  } else {
                    Masking.setup(logMasking);
                    var socketLogConfig = result.get();
                    var uri = socketLogConfig.uri();
                    if (!connectToOwnServer(loggerSetup, socketLogConfig.minLogLevel(), uri)) {
                      LoggingServiceManager.teardown();
                      loggingServiceEndpointPromise.failure(new LoggerInitializationFailed());
                    } else {
                      loggingServiceEndpointPromise.success(Option.apply(uri));
                    }
                  }
                  return Unit$.MODULE$;
                } catch (MissingConfigurationField e) {
                  throw new RuntimeException(e);
                } finally {
                  MDC.clear();
                }
              },
              ec);
    } else {
      // Setup logger according to config
      if (loggerSetup.setup(logLevel, logPath(), logFileSuffix(), loggerSetup.getConfig())) {
        loggingServiceEndpointPromise.success(Option.empty());
      } else {
        fallBackToLocalLogging(
            logLevel,
            logMasking,
            loggerSetup,
            "Could not set up logging from the configuration",
            null);
      }
    }
  }

  /* Note [Each Process Hosts Its Own Logging Server]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A process whose config has `logging-service.server.start` set (the language
   * server, see `application-ls.conf`) hosts its own logging server and forwards
   * its own logs to it through a `socket` appender. The server writes them to that
   * process's log file - for a language server, its project's log file.
   *
   * The server's port defaults to 0, so every process gets its own free port from
   * the operating system, and the socket appender is pointed at the port actually
   * bound rather than at the configured one (`connectToOwnServer`). A fixed default
   * (6000, formerly) made every language server on the machine share one port: the
   * first one hosted, the rest silently failed to bind and sent their logs into
   * the first one's project log - losing them once it closed - or to whatever
   * unrelated program owned the port.
   *
   * `ENSO_LOGSERVER_PORT` still sets the port explicitly. If binding it fails, the
   * process does not connect to whoever holds it: it logs locally, to the same
   * sinks the server would have used, and warns that it did
   * (`fallBackToLocalLogging`).
   */

  /**
   * Points this process's logging at the logging server it has just started.
   *
   * <p>A {@code socket} default appender is connected to the server's actual URI, not to the port
   * in its config: see Note [Each Process Hosts Its Own Logging Server]. Any other default appender
   * is set up from the config as before.
   */
  private static boolean connectToOwnServer(LoggerSetup loggerSetup, Level logLevel, URI uri)
      throws MissingConfigurationField {
    if (loggerSetup.getConfig().getAppender() instanceof SocketAppender) {
      return loggerSetup.setupSocketAppender(logLevel, uri.getHost(), uri.getPort());
    } else {
      return loggerSetup.setup(logLevel);
    }
  }

  /**
   * Logs locally because no logging server can be used, and records a warning saying why.
   *
   * <p>A process that would host a logging server writes to that server's sinks (see {@link
   * LoggerSetup#setupLocalSinks}); any other process uses its default appender, unless that is the
   * {@code socket} one that just failed, in which case it uses its {@code file} appender. If none
   * of these can be set up, it logs to the console.
   *
   * @param reason why the logging server cannot be used, for the warning
   * @param cause the underlying failure, if any
   */
  private void fallBackToLocalLogging(
      Level logLevel, boolean logMasking, LoggerSetup loggerSetup, String reason, Throwable cause) {
    var config = loggerSetup.getConfig();
    boolean initialized;
    if (config.getServer() != null) {
      initialized =
          loggerSetup.setupLocalSinks(logLevel, logPath(), logFileSuffix(), config.getServer());
    } else if (!(config.getAppender() instanceof SocketAppender)) {
      initialized = loggerSetup.setup(logLevel, logPath(), logFileSuffix(), config);
    } else if (config.getFileAppender() != null) {
      initialized = loggerSetup.setupFileAppender(logLevel, logPath(), logFileSuffix());
    } else {
      initialized = false;
    }
    if (!initialized) {
      initialized = loggerSetup.setupConsoleAppender(logLevel);
    }
    if (initialized) {
      Masking.setup(logMasking);
      var detail = cause == null ? "" : " (" + cause.getMessage() + ")";
      logger.warn("{}{}; logging locally instead.", reason, detail);
      loggingServiceEndpointPromise.success(Option.empty());
    } else {
      System.err.println(reason + "; logging locally failed too.");
      loggingServiceEndpointPromise.failure(new LoggerInitializationFailed());
    }
  }

  /**
   * Initializes logging for this service using the URI of the dedicated logging server. If
   * connecting to the logging server failed, or the optional address is missing, log events will be
   * handled purely based on configuration packaged with this service.
   *
   * @param logLevel optional maximal level of log events that will be handled by the logging
   *     infrastructure
   * @param connectToExternalLogger optional address of the logging server
   * @param logMasking true if sensitive data should be masked in log events, false otherwise
   * @throws MissingConfigurationField if the config file has been mis-configured
   */
  public void setup(Option<Level> logLevel, Option<URI> connectToExternalLogger, boolean logMasking)
      throws MissingConfigurationField {
    initLogger();
    var loggerSetup = LoggerSetup.get();
    var actualLogLevel = logLevel.getOrElse(() -> defaultLogLevel());
    if (connectToExternalLogger.isDefined()) {
      var uri = connectToExternalLogger.get();
      if (loggerSetup.setupSocketAppender(actualLogLevel, uri.getHost(), uri.getPort())) {
        Masking.setup(logMasking);
        loggingServiceEndpointPromise.success(Option.empty());
      } else {
        fallBackToLocalLogging(
            actualLogLevel,
            logMasking,
            loggerSetup,
            "Could not connect to the logging server at " + uri,
            null);
      }
    } else {
      if (loggerSetup.setup(actualLogLevel, logPath(), logFileSuffix(), loggerSetup.getConfig())) {
        Masking.setup(logMasking);
        loggingServiceEndpointPromise.success(Option.empty());
      } else {
        fallBackToLocalLogging(
            actualLogLevel,
            logMasking,
            loggerSetup,
            "Could not set up logging from the configuration",
            null);
      }
    }
  }

  public void waitForSetup() throws InterruptedException, TimeoutException {
    Await.ready(
        loggingServiceEndpointPromise.future(), Duration$.MODULE$.apply(5, TimeUnit.SECONDS));
  }

  public void tearDown(UUID projectId) {
    LoggingServiceManager.teardown(projectId);
  }

  public void tearDown() {
    LoggingServiceManager.teardown();
  }
}
