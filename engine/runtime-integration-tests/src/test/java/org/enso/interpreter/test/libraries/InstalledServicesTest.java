package org.enso.interpreter.test.libraries;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.enso.test.utils.ProjectUtils;
import org.graalvm.polyglot.Value;
import org.junit.ClassRule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * {@code Meta.lookup_services} over libraries that are installed but not imported (Note [Service
 * Discovery Over Installed Libraries] in {@code LookupServicesNode}). The libraries sit next to the
 * project, which {@link ProjectUtils#createProject} makes prefer local libraries: {@code
 * Fixture.Api} defines the service, {@code Fixture.Zeta} (imported) and {@code Fixture.Alpha}
 * (never imported) provide it, and {@code Fixture.Broken} registers a provider whose module does
 * not exist.
 */
public final class InstalledServicesTest {
  @ClassRule public static final TemporaryFolder tmp = new TemporaryFolder();

  private static void writeLibrary(Path root, String dir, String packageYaml, String services)
      throws IOException {
    var src = Files.createDirectories(root.resolve(dir).resolve("src"));
    Files.writeString(root.resolve(dir).resolve("package.yaml"), packageYaml);
    Files.writeString(src.resolve("Main.enso"), "");
    if (services != null) {
      Files.writeString(src.resolve("Services.enso"), services);
    }
  }

  private static String providerYaml(String name, String with) {
    return """
    name: %s
    namespace: Fixture
    version: 0.0.1
    services:
      - provides: Fixture.Api.Main.Spi
        with: %s
    """
        .formatted(name, with);
  }

  private static String providerServices(String label) {
    return """
    from Fixture.Api import Spi

    type Impl

    Spi.from (that:Impl) =
        _ = that
        Spi.Value "%s"
    """
        .formatted(label);
  }

  private static List<String> strings(Value vector) {
    var result = new ArrayList<String>();
    for (long i = 0; i < vector.getArraySize(); i++) {
      result.add(vector.getArrayElement(i).asString());
    }
    return result;
  }

  @Test
  public void findsInstalledProvidersAfterLoadedOnesAndSkipsBrokenOnes() throws IOException {
    var root = tmp.newFolder().toPath();
    var api = root.resolve("Fixture_Api");
    Files.createDirectories(api.resolve("src"));
    Files.writeString(
        api.resolve("package.yaml"),
        """
        name: Api
        namespace: Fixture
        version: 0.0.1
        """);
    Files.writeString(
        api.resolve("src").resolve("Main.enso"),
        """
        type Spi
            Value name
        """);
    writeLibrary(
        root,
        "Fixture_Zeta",
        providerYaml("Zeta", "Fixture.Zeta.Services.Impl"),
        providerServices("zeta"));
    writeLibrary(
        root,
        "Fixture_Alpha",
        providerYaml("Alpha", "Fixture.Alpha.Services.Impl"),
        providerServices("alpha"));
    writeLibrary(
        root, "Fixture_Broken", providerYaml("Broken", "Fixture.Broken.No_Such_Module.Impl"), null);

    var projDir = Files.createDirectory(root.resolve("Proj"));
    ProjectUtils.createProject(
        "Proj",
        """
        import Standard.Base.Meta
        import Standard.Base.Warning.Warning
        from Standard.Base.Data.Boolean import True
        from Fixture.Api import Spi
        import Fixture.Zeta

        main =
            before = Meta.lookup_services Spi loaded_only=True . map .name
            found = Meta.lookup_services Spi
            after = Meta.lookup_services Spi loaded_only=True . map .name
            [before, found.map .name, (Warning.get_all found).length, after]
        """,
        projDir);

    ProjectUtils.testProjectRun(
        projDir,
        res -> {
          assertEquals(
              "only the imported provider is loaded",
              List.of("zeta"),
              strings(res.getArrayElement(0)));
          assertEquals(
              "loaded first, then by name",
              List.of("zeta", "alpha"),
              strings(res.getArrayElement(1)));
          assertEquals(
              "the broken provider is skipped, not a warning", 0, res.getArrayElement(2).asInt());
          assertEquals(
              "resolving loaded Alpha", List.of("zeta", "alpha"), strings(res.getArrayElement(3)));
        });
  }
}
