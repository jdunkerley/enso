package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.function.Consumer;
import org.enso.common.RuntimeOptions;
import org.enso.editions.LibraryName;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.polyglot.PolyglotContext;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A cached module's IR records what its names resolved to in other libraries, so it must not be
 * reused once one of those libraries' sources changed (#542). See Note [A Cache Records The
 * Libraries It Refers To] in {@code LibraryDependencies}.
 *
 * <p>The project {@code Proj} imports library {@code Alpha}, which imports library {@code Beta}.
 * The tests edit {@code Beta} and check that {@code Alpha}'s cached IR, whether in its per-module IR
 * cache or in its bindings cache, is not used.
 */
public class CrossLibraryCacheTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  /**
   * Unique per run: the per-module IR caches are per user, keyed by the library's namespace, name
   * and version, so a fixed name would meet the caches of an earlier run.
   */
  private final String ns = "Cross" + randomWord();

  private final String project = "Proj" + randomWord();

  private Path irCacheRoot;

  private static final String PROJ_MAIN =
      """
      from %s.Alpha import all

      main = alpha_value
      """;

  /** Its IR records where `answer` was found: in Beta. */
  private static final String ALPHA_MAIN =
      """
      from %s.Beta import all

      alpha_value = answer
      """;

  @After
  public void deleteIrCaches() throws IOException {
    if (irCacheRoot != null) {
      for (var dir : new Path[] {irCacheRoot.resolve(ns), irCacheRoot.resolve("local").resolve(project)}) {
        if (Files.isDirectory(dir)) {
          ProjectUtils.deleteRecursively(dir);
        }
      }
    }
  }

  /**
   * (a) `answer` moves inside Beta, from `Beta.Main` to `Beta.Impl`, which `Beta.Main` re-exports.
   * Alpha's cached IR still says `Beta.Main.answer`, which is gone; it must be recompiled.
   */
  @Test
  public void editingAnImportedLibraryRecompilesTheImporter() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));

    writeLibrary(
        root, "Beta", Map.of("Main", "export project.Impl.answer\n", "Impl", "answer = 2\n"));
    var loaded = new HashMap<String, Boolean>();
    assertEquals(2L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertFalse("Alpha's IR is not reused once Beta changed", loaded.get("Alpha.Main"));
    assertTrue("the project's own IR is still reused", loaded.get("Proj.Main"));
  }

  /** (a), with Alpha's IR in its bindings cache (`enso --compile`) rather than per module. */
  @Test
  public void editingAnImportedLibraryInvalidatesTheImportersBindingsCache() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    compile(root.resolve("Alpha"));
    assertEquals(1L, run(root, ctx -> {}));

    writeLibrary(
        root, "Beta", Map.of("Main", "export project.Impl.answer\n", "Impl", "answer = 2\n"));
    var bindingsUsed = new boolean[1];
    assertEquals(
        2L,
        run(
            root,
            ctx ->
                bindingsUsed[0] =
                    ImportExportCache.create(new LibraryName(ns, "Alpha")).load(ctx).isPresent()));
    assertFalse("Alpha's bindings cache is not used once Beta changed", bindingsUsed[0]);
  }

  /**
   * (b) `Beta.Helpers` moves to another library, `Gamma`, as SQLite moved out of Database (#468).
   * Alpha's cached IR names a module that no longer exists: a cache miss, not an error.
   */
  @Test
  public void aModuleThatMovedToAnotherLibraryIsACacheMiss() throws IOException {
    var root =
        createTree(Map.of("Main", "export project.Helpers.answer\n", "Helpers", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));

    Files.delete(root.resolve("Beta").resolve("src").resolve("Helpers.enso"));
    writeLibrary(root, "Beta", Map.of("Main", "export " + ns + ".Gamma.Helpers.answer\n"));
    writeLibrary(root, "Gamma", Map.of("Main", "", "Helpers", "answer = 2\n"));
    var loaded = new HashMap<String, Boolean>();
    assertEquals(2L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertFalse("Alpha's IR is not reused once Beta changed", loaded.get("Alpha.Main"));
  }

  /** (b), with Alpha's IR in its bindings cache. */
  @Test
  public void aModuleThatMovedToAnotherLibraryIsABindingsCacheMiss() throws IOException {
    var root =
        createTree(Map.of("Main", "export project.Helpers.answer\n", "Helpers", "answer = 1\n"));
    compile(root.resolve("Alpha"));
    assertEquals(1L, run(root, ctx -> {}));

    Files.delete(root.resolve("Beta").resolve("src").resolve("Helpers.enso"));
    writeLibrary(root, "Beta", Map.of("Main", "export " + ns + ".Gamma.Helpers.answer\n"));
    writeLibrary(root, "Gamma", Map.of("Main", "", "Helpers", "answer = 2\n"));
    assertEquals(2L, run(root, ctx -> {}));
  }

  /** (c) Nothing changed: every module is loaded from its cache. */
  @Test
  public void nothingChangedEverythingHitsTheCache() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));
    var loaded = new HashMap<String, Boolean>();
    assertEquals(1L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertEquals(
        "an unchanged reopen loads every module from its cache",
        Map.of("Proj.Main", true, "Alpha.Main", true, "Beta.Main", true),
        loaded);
  }

  /** (c), with Alpha's IR in its bindings cache. */
  @Test
  public void nothingChangedTheBindingsCacheIsUsed() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    compile(root.resolve("Alpha"));
    var bindingsUsed = new boolean[1];
    assertEquals(
        1L,
        run(
            root,
            ctx ->
                bindingsUsed[0] =
                    ImportExportCache.create(new LibraryName(ns, "Alpha")).load(ctx).isPresent()));
    assertTrue("Alpha's bindings cache is used", bindingsUsed[0]);
  }

  /**
   * Same-library edits keep their per-module granularity (#541's review): editing the project's own
   * module does not cost the libraries it imports their IR.
   */
  @Test
  public void editingTheProjectKeepsTheLibrariesIr() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));
    Files.writeString(
        root.resolve("Proj").resolve("src").resolve("Main.enso"),
        PROJ_MAIN.formatted(ns) + "other = 0\n");
    var loaded = new HashMap<String, Boolean>();
    assertEquals(1L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertEquals(
        Map.of("Proj.Main", false, "Alpha.Main", true, "Beta.Main", true), loaded);
  }

  private Map<String, Boolean> loadedFromCache(EnsoContext ctx) {
    var result = new HashMap<String, Boolean>();
    for (var entry :
        Map.of(
                "Proj.Main", "local." + project + ".Main",
                "Alpha.Main", ns + ".Alpha.Main",
                "Beta.Main", ns + ".Beta.Main")
            .entrySet()) {
      var found = ctx.findModule(entry.getValue());
      result.put(entry.getKey(), found.isPresent() && found.get().wasLoadedFromCache());
    }
    return result;
  }

  /** Beta with the given modules, Alpha importing it, and the project importing Alpha. */
  private Path createTree(Map<String, String> beta) throws IOException {
    var root = tmp.newFolder("tree").toPath();
    writeLibrary(root, "Beta", beta);
    writeLibrary(root, "Alpha", Map.of("Main", ALPHA_MAIN.formatted(ns)));
    var proj = Files.createDirectory(root.resolve("Proj"));
    ProjectUtils.createProject(project, PROJ_MAIN.formatted(ns), proj);
    return root;
  }

  private void writeLibrary(Path root, String name, Map<String, String> modules)
      throws IOException {
    var dir = root.resolve(name);
    var src = Files.createDirectories(dir.resolve("src"));
    Files.writeString(
        dir.resolve("package.yaml"),
        """
        name: %s
        namespace: %s
        version: 0.0.1
        prefer-local-libraries: true
        """
            .formatted(name, ns));
    for (var module : modules.entrySet()) {
      Files.writeString(src.resolve(module.getKey() + ".enso"), module.getValue());
    }
  }

  private static ContextUtils.Builder builder(Path projectRoot) {
    return ContextUtils.newBuilder()
        .withModifiedContext(
            bldr ->
                bldr.option(RuntimeOptions.DISABLE_IR_CACHES, "false")
                    .option(RuntimeOptions.WAIT_FOR_PENDING_SERIALIZATION_JOBS, "true")
                    .option(RuntimeOptions.STRICT_ERRORS, "true"))
        .withProjectRoot(projectRoot);
  }

  /** `enso --compile` of a library: writes its bindings and suggestions caches. */
  private static void compile(Path libraryRoot) {
    try (var ctx = builder(libraryRoot).build()) {
      new PolyglotContext(ctx.context()).getTopScope().compile(true);
    }
  }

  /**
   * `enso --run` of the project: runs `main`, then hands the context to {@code inContext}.
   *
   * @return what `main` returned
   */
  private long run(Path root, Consumer<EnsoContext> inContext) {
    var projectRoot = root.resolve("Proj");
    try (var ctx = builder(projectRoot).build()) {
      var polyCtx = new PolyglotContext(ctx.context());
      var mainMod =
          polyCtx.evalModule(projectRoot.resolve("src").resolve("Main.enso").toFile());
      var result = mainMod.getMethod(mainMod.getAssociatedType(), "main").get().execute().asLong();
      var ensoCtx = ctx.ensoContext();
      irCacheRoot =
          ensoCtx.getDistributionManager().LocallyInstalledDirectories().irCacheDirectory();
      ctx.context().enter();
      try {
        inContext.accept(ensoCtx);
      } finally {
        ctx.context().leave();
      }
      return result;
    }
  }

  private static String randomWord() {
    var random = new Random();
    var sb = new StringBuilder();
    for (var i = 0; i < 8; i++) {
      sb.append((char) ('a' + random.nextInt(26)));
    }
    return sb.toString();
  }
}
