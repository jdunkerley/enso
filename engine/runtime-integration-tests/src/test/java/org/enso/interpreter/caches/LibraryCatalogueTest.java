package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.enso.common.RuntimeOptions;
import org.enso.pkg.PackageManager$;
import org.enso.pkg.QualifiedName;
import org.enso.polyglot.LibraryCatalogue;
import org.enso.polyglot.PolyglotContext;
import org.enso.polyglot.Suggestion;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** `enso --compile` writes the library's catalogue (Note [Library Catalogue]). */
public class LibraryCatalogueTest {
  @Rule public final TemporaryFolder tmpFolder = new TemporaryFolder();

  private static final String MAIN =
      """
      import project.Internal.Helpers

      ## A shape.
      type Shape
          ## A circle.
          Circle radius

          ## A square.
          Square side

          ## A unit circle.
          unit = Shape.Circle 1

          ## ---
             private: true
             ---
             Hidden from the component browser.
          hidden self = Helpers.helper

      ## Returns its argument.
      same x = x
      """;

  private static final String HELPERS =
      """
      ## Used by `Shape.hidden` only.
      helper = 42
      """;

  @Test
  public void compilingWritesTheCatalogueOfThePublicEntries() throws IOException {
    var projDir = createLibrary();
    compile(projDir);

    var catalogue = readCatalogue(projDir);
    assertEquals("local.Catalogued", catalogue.library());
    assertEquals("0.0.1", catalogue.version());
    assertFalse(catalogue.engineVersion().isEmpty());
    assertEquals(sourceHash(projDir), catalogue.sourceHash());

    var names = entryNames(catalogue);
    var expected =
        Set.of(
            "local.Catalogued.Main",
            "local.Catalogued.Main.Shape",
            "local.Catalogued.Main.Circle",
            "local.Catalogued.Main.Square",
            "local.Catalogued.Main.unit",
            "local.Catalogued.Main.same");
    assertTrue(names.toString(), names.containsAll(expected));
    assertFalse(names.toString(), names.contains("local.Catalogued.Main.hidden"));
    assertFalse(
        names.toString(), names.stream().anyMatch(n -> n.startsWith("local.Catalogued.Internal")));

    var unit =
        entries(catalogue).stream()
            .filter(s -> s instanceof Suggestion.Method && s.name().equals("unit"))
            .map(s -> (Suggestion.Method) s)
            .findFirst()
            .orElseThrow();
    assertTrue("`unit` is static", unit.isStatic());
  }

  @Test
  public void changingASourceChangesTheHash() throws IOException {
    var projDir = createLibrary();
    compile(projDir);
    var before = readCatalogue(projDir).sourceHash();

    Files.writeString(
        projDir.resolve("src").resolve("Main.enso"), MAIN + "\n## Another.\nother = 1\n");
    // The library's bindings cache is not checked against the sources: with it,
    // the second compilation would reuse the old modules' IR
    // (`TruffleCompilerContext.deserializeModule`), so drop the caches.
    deleteRecursively(projDir.resolve(".enso"));
    compile(projDir);

    var after = readCatalogue(projDir);
    assertNotEquals(before, after.sourceHash());
    assertEquals(sourceHash(projDir), after.sourceHash());
    assertTrue(
        entryNames(after).toString(), entryNames(after).contains("local.Catalogued.Main.other"));
  }

  private static void deleteRecursively(Path dir) throws IOException {
    if (Files.exists(dir)) {
      try (var paths = Files.walk(dir)) {
        for (var path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
          Files.delete(path);
        }
      }
    }
  }

  @Test
  public void aLibraryCanDeclineACatalogue() throws IOException {
    var projDir = createLibrary();
    compile(projDir);
    assertTrue(Files.isRegularFile(projDir.resolve(LibraryCatalogue.FileName())));

    Files.writeString(
        projDir.resolve("package.yaml"),
        "catalogue: false\n",
        java.nio.file.StandardOpenOption.APPEND);
    compile(projDir);
    assertFalse(
        "catalogue: false removes the catalogue",
        Files.exists(projDir.resolve(LibraryCatalogue.FileName())));
  }

  private Path createLibrary() throws IOException {
    var projDir = tmpFolder.newFolder("Catalogued").toPath();
    ProjectUtils.createProject(
        "Catalogued",
        Set.of(
            new SourceModule(QualifiedName.fromString("Main"), MAIN),
            new SourceModule(QualifiedName.fromString("Internal.Helpers"), HELPERS)),
        projDir);
    return projDir;
  }

  private static void compile(Path projDir) {
    try (var ctx =
        ContextUtils.newBuilder()
            .withModifiedContext(bldr -> bldr.option(RuntimeOptions.DISABLE_IR_CACHES, "false"))
            .withProjectRoot(projDir)
            .build()) {
      new PolyglotContext(ctx.context()).getTopScope().compile(true);
    }
  }

  private static LibraryCatalogue readCatalogue(Path projDir) throws IOException {
    var file = projDir.resolve(LibraryCatalogue.FileName());
    assertTrue("catalogue.json is written next to package.yaml", Files.isRegularFile(file));
    return LibraryCatalogue.fromJson(Files.readString(file))
        .fold(
            error -> {
              throw new AssertionError("Cannot read the catalogue: " + error);
            },
            catalogue -> catalogue);
  }

  private static String sourceHash(Path projDir) {
    return PackageManager$.MODULE$.Default().loadPackage(projDir.toFile()).get().sourceHash();
  }

  private static List<Suggestion> entries(LibraryCatalogue catalogue) {
    return scala.jdk.javaapi.CollectionConverters.asJava(catalogue.entries());
  }

  /** A module by its name, anything else by its module and name. */
  private static Set<String> entryNames(LibraryCatalogue catalogue) {
    return entries(catalogue).stream()
        .map(s -> s instanceof Suggestion.Module ? s.module() : s.module() + "." + s.name())
        .collect(Collectors.toSet());
  }
}
