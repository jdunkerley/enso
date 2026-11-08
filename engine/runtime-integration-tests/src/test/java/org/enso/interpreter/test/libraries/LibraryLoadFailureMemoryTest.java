package org.enso.interpreter.test.libraries;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.enso.cli.task.TaskProgress;
import org.enso.common.RuntimeOptions;
import org.enso.distribution.locking.Resource;
import org.enso.editions.LibraryName;
import org.enso.editions.LibraryVersion;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.instrument.NotificationHandler;
import org.enso.pkg.QualifiedName;
import org.enso.polyglot.PolyglotContext;
import org.enso.test.utils.ContextUtils;
import org.junit.ClassRule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import scala.Option;

/**
 * Which library failures the package repository remembers, and which it reports (Note [A Failed
 * Library Is Remembered] in {@code DefaultPackageRepository}): a failed download and a library the
 * edition does not define are not tried again; a missing local library is, so one created while the
 * project is open loads; only an import's failure is reported.
 */
public final class LibraryLoadFailureMemoryTest {
  @ClassRule public static final TemporaryFolder tmp = new TemporaryFolder();

  private static final String EDITION_NAME = "memory_edition";

  /** Records the reported failures as {@code "<library> <kind>"}. */
  private static final class Recorder implements NotificationHandler {
    final List<String> failures = new CopyOnWriteArrayList<>();

    @Override
    public void addedLibrary(LibraryName name, LibraryVersion version, Path location) {}

    @Override
    public void libraryLoadFailed(
        LibraryName name, Option<LibraryVersion> version, String kind, String message) {
      failures.add(name.qualifiedName() + " " + kind);
    }

    @Override
    public void serializeModule(QualifiedName moduleName) {}

    @Override
    public void trackProgress(String message, TaskProgress<?> task) {}

    @Override
    public void startWaitingForResource(Resource resource) {}

    @Override
    public void finishWaitingForResource(Resource resource) {}
  }

  private static String parentEdition() {
    var env = System.getenv("ENSO_EDITION");
    return env != null ? env : "0.0.0-dev";
  }

  /** A project in {@code root} that names the edition and runs {@code main = 42}. */
  private static Path createProject(Path root, boolean preferLocal) throws IOException {
    var projDir = Files.createDirectories(root.resolve("Proj"));
    Files.writeString(
        projDir.resolve("package.yaml"),
        """
        name: Proj
        namespace: local
        version: 0.0.1
        edition: '%s'
        prefer-local-libraries: %s
        """
            .formatted(EDITION_NAME, preferLocal));
    Files.writeString(
        Files.createDirectories(projDir.resolve("src")).resolve("Main.enso"), "main = 42\n");
    return projDir;
  }

  private static void createLibrary(Path root, String name) throws IOException {
    var libRoot = Files.createDirectories(root.resolve("Fixture_" + name));
    Files.writeString(
        libRoot.resolve("package.yaml"),
        """
        name: %s
        namespace: Fixture
        version: 0.0.1
        """
            .formatted(name));
    Files.writeString(
        Files.createDirectories(libRoot.resolve("src")).resolve("Main.enso"), "value = 42\n");
  }

  /** Runs {@code body} in a context of the project, with the edition in {@code editions}. */
  private static void inProject(Path projDir, Path editions, ContextBody body) throws Exception {
    try (var ctx =
        ContextUtils.newBuilder()
            .withModifiedContext(
                b ->
                    b.option(RuntimeOptions.PROJECT_ROOT, projDir.toAbsolutePath().toString())
                        .option(RuntimeOptions.DISABLE_IR_CACHES, "true")
                        .option(RuntimeOptions.EDITION_OVERRIDE, EDITION_NAME)
                        .option(
                            RuntimeOptions.EDITIONS_DIRECTORY,
                            editions.toAbsolutePath().toString()))
            .build()) {
      var ensoCtx = ctx.ensoContext();
      var recorder = new Recorder();
      ((NotificationHandler.Forwarder) ensoCtx.getNotificationHandler()).addListener(recorder);
      var mod =
          new PolyglotContext(ctx.context())
              .evalModule(projDir.resolve("src").resolve("Main.enso").toFile());
      assertEquals(42, mod.getMethod(mod.getAssociatedType(), "main").get().execute().asInt());
      body.run(ensoCtx, recorder);
    }
  }

  @FunctionalInterface
  private interface ContextBody {
    void run(EnsoContext ctx, Recorder recorder) throws Exception;
  }

  private static Path writeEdition(Path root, String libraries) throws IOException {
    var editions = Files.createDirectories(root.resolve("editions"));
    Files.writeString(
        editions.resolve(EDITION_NAME + ".yaml"), "extends: " + parentEdition() + "\n" + libraries);
    return editions;
  }

  @Test
  public void aFailedDownloadIsNotTriedAgain() throws Exception {
    var hits = new AtomicInteger();
    // A repository that answers every request with 502 Bad Gateway, counting them.
    var server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    var serving =
        new Thread(
            () -> {
              while (!server.isClosed()) {
                try (var socket = server.accept()) {
                  hits.incrementAndGet();
                  var in =
                      new BufferedReader(
                          new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                  String line;
                  while ((line = in.readLine()) != null && !line.isEmpty()) {}
                  socket
                      .getOutputStream()
                      .write(
                          "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                              .getBytes(StandardCharsets.US_ASCII));
                } catch (IOException e) {
                  // Closed by the test.
                }
              }
            });
    serving.setDaemon(true);
    serving.start();
    try {
      var root = tmp.newFolder().toPath();
      var editions =
          writeEdition(
              root,
              """
              repositories:
                - name: failing
                  url: http://127.0.0.1:%d/libraries
              libraries:
                - name: Fixture.Eta
                  version: 1.0.0
                  repository: failing
              """
                  .formatted(server.getLocalPort()));
      inProject(
          createProject(root, false),
          editions,
          (ctx, recorder) -> {
            var eta = new LibraryName("Fixture", "Eta");
            var repo = ctx.getPackageRepository();
            assertTrue(repo.ensurePackageIsLoadedForImport(eta).isLeft());
            var afterFirst = hits.get();
            assertTrue("the repository was asked", afterFirst > 0);
            assertTrue(repo.ensurePackageIsLoadedForImport(eta).isLeft());
            assertTrue(repo.ensurePackageIsLoaded(eta).isLeft());
            assertEquals("no second download", afterFirst, hits.get());
            assertEquals(List.of("Fixture.Eta DownloadFailed"), recorder.failures);
          });
    } finally {
      server.close();
    }
  }

  @Test
  public void aLibraryNotInTheEditionIsNotTriedAgain() throws Exception {
    var root = tmp.newFolder().toPath();
    inProject(
        createProject(root, false),
        writeEdition(root, ""),
        (ctx, recorder) -> {
          var theta = new LibraryName("Fixture", "Theta");
          var repo = ctx.getPackageRepository();
          assertTrue(repo.ensurePackageIsLoadedForImport(theta).isLeft());
          assertTrue(repo.ensurePackageIsLoadedForImport(theta).isLeft());
          assertEquals(List.of("Fixture.Theta NotInEdition"), recorder.failures);
        });
  }

  @Test
  public void aMissingLocalLibraryIsTriedAgainAndLoadsOnceCreated() throws Exception {
    var root = tmp.newFolder().toPath();
    inProject(
        createProject(root, false),
        writeEdition(
            root,
            """
            libraries:
              - name: Fixture.Iota
                repository: local
            """),
        (ctx, recorder) -> {
          var iota = new LibraryName("Fixture", "Iota");
          var repo = ctx.getPackageRepository();
          assertTrue(repo.ensurePackageIsLoadedForImport(iota).isLeft());
          assertTrue(repo.ensurePackageIsLoadedForImport(iota).isLeft());
          assertEquals("reported once", List.of("Fixture.Iota LocalMissing"), recorder.failures);
          createLibrary(root, "Iota");
          assertTrue(
              "loads once created, without a reopen",
              repo.ensurePackageIsLoadedForImport(iota).isRight());
        });
  }

  @Test
  public void aProjectPreferringLocalLibrariesTriesAgain() throws Exception {
    var root = tmp.newFolder().toPath();
    inProject(
        createProject(root, true),
        writeEdition(root, ""),
        (ctx, recorder) -> {
          var kappa = new LibraryName("Fixture", "Kappa");
          var repo = ctx.getPackageRepository();
          assertTrue(repo.ensurePackageIsLoadedForImport(kappa).isLeft());
          assertEquals(List.of("Fixture.Kappa NotInEdition"), recorder.failures);
          createLibrary(root, "Kappa");
          assertTrue(repo.ensurePackageIsLoadedForImport(kappa).isRight());
        });
  }

  @Test
  public void onlyAnImportsFailureIsReported() throws Exception {
    var root = tmp.newFolder().toPath();
    inProject(
        createProject(root, false),
        writeEdition(root, ""),
        (ctx, recorder) -> {
          var lambda = new LibraryName("Fixture", "Lambda");
          var repo = ctx.getPackageRepository();
          assertTrue(repo.ensurePackageIsLoaded(lambda).isLeft());
          assertEquals(List.of(), recorder.failures);
          assertTrue(repo.ensurePackageIsLoadedForImport(lambda).isLeft());
          assertEquals(List.of("Fixture.Lambda NotInEdition"), recorder.failures);
        });
  }
}
