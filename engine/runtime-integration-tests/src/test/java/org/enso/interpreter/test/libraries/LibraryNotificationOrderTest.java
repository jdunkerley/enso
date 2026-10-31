package org.enso.interpreter.test.libraries;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
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
import org.enso.test.utils.ProjectUtils;
import org.junit.ClassRule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * The package repository must register a library before it announces it (Note [Package Registered
 * Before Notification] in {@code DefaultPackageRepository}). The listener queues background work
 * (suggestions loading) that looks the library up, so a listener has to find it already loaded.
 */
public final class LibraryNotificationOrderTest {
  @ClassRule public static final TemporaryFolder tmp = new TemporaryFolder();

  /** Records, for every announced library, whether the repository already knew its package. */
  private static final class Recorder implements NotificationHandler {
    private final EnsoContext ctx;
    final List<String> seen = new CopyOnWriteArrayList<>();
    final List<String> missing = new CopyOnWriteArrayList<>();

    Recorder(EnsoContext ctx) {
      this.ctx = ctx;
    }

    @Override
    public void addedLibrary(LibraryName name, LibraryVersion version, Path location) {
      seen.add(name.qualifiedName());
      var repo = ctx.getPackageRepository();
      if (!repo.getPackageForLibrary(name).isDefined() || !repo.isPackageLoaded(name)) {
        missing.add(name.qualifiedName());
      }
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

  @Test
  public void listenerSeesTheLibraryAlreadyRegistered() throws IOException {
    var root = tmp.newFolder().toPath();
    var libRoot = Files.createDirectories(root.resolve("Fixture_Zeta"));
    Files.writeString(
        libRoot.resolve("package.yaml"),
        """
        name: Zeta
        namespace: Fixture
        version: 0.0.1
        """);
    Files.writeString(
        Files.createDirectories(libRoot.resolve("src")).resolve("Main.enso"), "value = 42\n");

    var projDir = Files.createDirectory(root.resolve("Proj"));
    ProjectUtils.createProject(
        "Proj",
        """
        import Fixture.Zeta
        main = Zeta.value
        """,
        projDir);

    try (var ctx =
        ContextUtils.newBuilder()
            .withModifiedContext(
                b ->
                    b.option(RuntimeOptions.PROJECT_ROOT, projDir.toAbsolutePath().toString())
                        .option(RuntimeOptions.DISABLE_IR_CACHES, "true"))
            .build()) {
      var ensoCtx = ctx.ensoContext();
      var recorder = new Recorder(ensoCtx);
      ((NotificationHandler.Forwarder) ensoCtx.getNotificationHandler()).addListener(recorder);

      var mod =
          new PolyglotContext(ctx.context())
              .evalModule(projDir.resolve("src").resolve("Main.enso").toFile());
      var res = mod.getMethod(mod.getAssociatedType(), "main").get().execute();

      assertEquals(42, res.asInt());
      assertTrue(
          "Fixture.Zeta was announced: " + recorder.seen, recorder.seen.contains("Fixture.Zeta"));
      assertEquals(
          "libraries the repository did not yet know when announced", List.of(), recorder.missing);
    }
  }
}
