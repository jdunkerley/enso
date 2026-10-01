package org.enso.logging.service.telemetry;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.SocketTimeoutException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.enso.logging.config.LoggerSetup;
import org.enso.logging.service.LoggingSetupHelper;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.Level;
import scala.concurrent.Await;
import scala.concurrent.ExecutionContext$;
import scala.concurrent.duration.Duration$;

/**
 * A language server whose logging server cannot bind its port logs to its own project's log file
 * instead, warns that it does, and does not connect to whoever holds the port. Note [Each Process
 * Hosts Its Own Logging Server] in {@link LoggingSetupHelper}.
 *
 * <p>{@link LoggingSetupHelper} sets up the process-wide logging once, so this is the only test of
 * it in this JVM.
 */
public class LoggingSetupHelperFallbackTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private ServerSocket taken;
  private Path logRoot;

  @Before
  public void setup() throws Exception {
    taken = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    logRoot = tmp.newFolder("logs").toPath();
    System.setProperty("config.resource", "logging-fallback-test.conf");
    System.setProperty("logging-service.server.port", Integer.toString(taken.getLocalPort()));
  }

  @After
  public void teardown() throws IOException {
    LoggerSetup.get().teardown();
    taken.close();
    MDC.clear();
    System.clearProperty("config.resource");
    System.clearProperty("logging-service.server.port");
  }

  private final class Helper extends LoggingSetupHelper {
    Helper() {
      super(ExecutionContext$.MODULE$.global());
    }

    @Override
    protected Level defaultLogLevel() {
      return Level.INFO;
    }

    @Override
    protected String logFileSuffix() {
      return "enso-language-server";
    }

    @Override
    protected Path logPath() {
      return logRoot;
    }
  }

  @Test
  public void fallsBackToTheProjectLogFileWhenThePortIsTaken() throws Exception {
    var port = taken.getLocalPort();
    MDC.put("projectLocalId", "project-a");
    var helper = new Helper();
    helper.setup(Level.INFO, false);
    var endpoint =
        Await.result(
            helper.loggingServiceEndpoint(), Duration$.MODULE$.apply(15, TimeUnit.SECONDS));

    assertThat("no logging server is hosted", endpoint.isEmpty(), is(true));
    LoggerFactory.getLogger(LoggingSetupHelperFallbackTest.class).info("logged after the fallback");

    var projectLogs = logRoot.resolve("project-a");
    var log = awaitLogContaining(projectLogs, "logged after the fallback");
    assertThat(log, containsString("Could not start the logging server on port " + port));
    assertThat(log, containsString("logging locally instead"));

    // Nothing connected to the program that holds the port.
    taken.setSoTimeout(500);
    assertThrows(SocketTimeoutException.class, taken::accept);
  }

  private static String awaitLogContaining(Path dir, String text) throws Exception {
    long deadline = System.currentTimeMillis() + 15_000;
    String contents = "";
    while (System.currentTimeMillis() < deadline) {
      if (Files.isDirectory(dir)) {
        try (var files = Files.list(dir)) {
          contents =
              files
                  .filter(f -> f.toString().endsWith(".log"))
                  .map(
                      f -> {
                        try {
                          return Files.readString(f);
                        } catch (IOException e) {
                          throw new UncheckedIOException(e);
                        }
                      })
                  .collect(Collectors.joining("\n"));
        }
        if (contents.contains(text)) {
          return contents;
        }
      }
      Thread.sleep(50);
    }
    throw new AssertionError("'" + text + "' never reached " + dir + "; it has: " + contents);
  }
}
