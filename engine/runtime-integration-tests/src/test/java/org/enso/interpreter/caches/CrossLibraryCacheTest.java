package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.DataInputStream;
import java.io.DataOutputStream;
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
 * The tests edit {@code Beta} and check that {@code Alpha}'s cached IR, whether in its per-module
 * IR cache or in its bindings cache, is not used.
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

  /** A second project, if a test made one. */
  private String otherProject;

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
      for (var dir :
          new Path[] {
            irCacheRoot.resolve(ns),
            irCacheRoot.resolve("local").resolve(project),
            irCacheRoot.resolve("local").resolve(otherProject == null ? project : otherProject)
          }) {
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
   * After an edit to Beta, the first run rejects Alpha's bindings cache and recompiles Alpha; the
   * second run is warm again: it reads Alpha's IR from a bindings cache, rewritten into the user
   * cache by the first, not from source (#562). A further edit to Beta still invalidates it. See
   * Note [A Rejected Bindings Cache Is Rewritten] in {@code TruffleCompilerContext}.
   */
  @Test
  public void afterAnEditTheSecondRunReadsTheImportersBindingsCacheAgain() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    compile(root.resolve("Alpha"));
    assertEquals(1L, run(root, ctx -> {}));

    writeLibrary(root, "Beta", Map.of("Main", "answer = 2\n"));
    var loaded = new HashMap<String, Boolean>();
    assertEquals(
        2L,
        run(
            root,
            ctx -> {
              loaded.putAll(loadedFromCache(ctx));
              awaitRewrittenBindings("Alpha");
            }));
    assertFalse("the first run after the edit recompiles Alpha", loaded.get("Alpha.Main"));

    // Only a bindings cache can now give Alpha's IR.
    deleteModuleCaches("Alpha");
    loaded.clear();
    assertEquals(2L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertTrue(
        "the second run reads Alpha from its rewritten bindings cache", loaded.get("Alpha.Main"));

    writeLibrary(root, "Beta", Map.of("Main", "answer = 3\n"));
    deleteModuleCaches("Alpha");
    loaded.clear();
    assertEquals(3L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertFalse("the rewritten cache is invalidated by another edit", loaded.get("Alpha.Main"));
  }

  /**
   * A rewritten bindings cache holds only the modules the run compiled. Alpha has two modules: the
   * first run after the edit (another project) uses only `Alpha.Main`, so the rewrite holds only
   * it; the next run, of a project whose cached `Main` also imports `Alpha.Other`, reads
   * `Alpha.Main` from the rewritten cache and compiles `Alpha.Other`, which the cache does not
   * have, from source (`DefaultPackageRepository.getLibraryBindings` answers `None` for it, not
   * `Some(null)`).
   */
  @Test
  public void aModuleMissingFromARewrittenBindingsCacheFallsBack() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    writeLibrary(
        root,
        "Alpha",
        Map.of(
            "Main", ALPHA_MAIN.formatted(ns),
            "Other", "from %s.Beta import all\n\nother_value = answer\n".formatted(ns)));
    Files.writeString(
        root.resolve("Proj").resolve("src").resolve("Main.enso"),
        """
        from %s.Alpha import all
        from %s.Alpha.Other import all

        main = other_value
        """
            .formatted(ns, ns));
    var other = "Other" + randomWord();
    var otherRoot = Files.createDirectory(root.resolve("Proj2"));
    ProjectUtils.createProject(other, PROJ_MAIN.formatted(ns), otherRoot);
    otherProject = other;

    compile(root.resolve("Alpha"));
    assertEquals(1L, run(root, ctx -> {}));

    writeLibrary(root, "Beta", Map.of("Main", "answer = 2\n"));
    assertEquals(2L, runProject(otherRoot, ctx -> awaitRewrittenBindings("Alpha")));
    deleteModuleCaches("Alpha");

    var loaded = new HashMap<String, Boolean>();
    assertEquals(
        2L,
        run(
            root,
            ctx -> {
              loaded.putAll(loadedFromCache(ctx));
              var o = ctx.findModule(ns + ".Alpha.Other");
              loaded.put("Alpha.Other", o.isPresent() && o.get().wasLoadedFromCache());
            }));
    assertTrue("Alpha.Main comes from the rewritten bindings cache", loaded.get("Alpha.Main"));
    assertFalse("Alpha.Other, missing from it, is compiled", loaded.get("Alpha.Other"));
    assertEquals("a second run gives the same result", 2L, run(root, ctx -> {}));
  }

  /**
   * Waits, while the context is still open, for the library's bindings cache to be rewritten into
   * the user cache: closing the context does not wait for the rewrite.
   */
  private void awaitRewrittenBindings(String library) {
    var deadline = System.currentTimeMillis() + 60_000;
    while (System.currentTimeMillis() < deadline) {
      try (var files = Files.walk(irCacheRoot.resolve(ns).resolve(library))) {
        if (files.anyMatch(f -> f.getFileName().toString().equals(library + ".bindings.meta"))) {
          return;
        }
      } catch (IOException | java.io.UncheckedIOException e) {
        // not there yet
      }
      try {
        Thread.sleep(50);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new AssertionError(e);
      }
    }
    throw new AssertionError(library + "'s bindings cache was not rewritten within 60 s");
  }

  /** Deletes the library's per-module IR caches, keeping any bindings cache. */
  private void deleteModuleCaches(String library) throws IOException {
    try (var files = Files.walk(irCacheRoot.resolve(ns).resolve(library))) {
      for (var f : files.toList()) {
        var name = f.getFileName().toString();
        if (name.endsWith(".ir") || name.endsWith(".meta")) {
          if (!name.endsWith(".bindings.meta")) {
            Files.delete(f);
          }
        }
      }
    }
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

  /**
   * (b), safety net: even when the libraries' hashes are not there to catch it, IR naming a module
   * that is gone is a miss when it is loaded, not a "Cannot convert" when a method body is first
   * called. See Note [A Cache That Does Not Load Is A Miss] in {@code Cache}.
   */
  @Test
  public void aCacheNamingAModuleThatIsGoneIsAMissEvenWithoutTheHashes() throws IOException {
    var root =
        createTree(Map.of("Main", "export project.Helpers.answer\n", "Helpers", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));
    var meta = findAlphaMainMetadata();
    dropLibraryHashes(meta);

    Files.delete(root.resolve("Beta").resolve("src").resolve("Helpers.enso"));
    writeLibrary(root, "Beta", Map.of("Main", "export " + ns + ".Gamma.Helpers.answer\n"));
    writeLibrary(root, "Gamma", Map.of("Main", "", "Helpers", "answer = 2\n"));
    var loaded = new HashMap<String, Boolean>();
    assertEquals(2L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertFalse("Alpha's IR is not reused", loaded.get("Alpha.Main"));
  }

  /** Safety net: an IR cache that does not deserialise is a miss, not an error. */
  @Test
  public void aCacheThatDoesNotDeserialiseIsAMiss() throws IOException {
    var root = createTree(Map.of("Main", "answer = 1\n"));
    assertEquals(1L, run(root, ctx -> {}));
    var ir = findAlphaMain(".ir");
    var bytes = Files.readAllBytes(ir);
    Files.write(ir, java.util.Arrays.copyOf(bytes, bytes.length / 2));

    var loaded = new HashMap<String, Boolean>();
    assertEquals(1L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    assertFalse("Alpha's IR is compiled from source", loaded.get("Alpha.Main"));
    assertEquals(
        "the next run uses the rewritten cache",
        Map.of("Proj.Main", true, "Alpha.Main", true, "Beta.Main", true),
        rerunLoadedFromCache(root));
  }

  private Map<String, Boolean> rerunLoadedFromCache(Path root) {
    var loaded = new HashMap<String, Boolean>();
    assertEquals(1L, run(root, ctx -> loaded.putAll(loadedFromCache(ctx))));
    return loaded;
  }

  private Path findAlphaMainMetadata() throws IOException {
    return findAlphaMain(".meta");
  }

  private Path findAlphaMain(String suffix) throws IOException {
    try (var files = Files.walk(irCacheRoot.resolve(ns).resolve("Alpha"))) {
      return files
          .filter(f -> f.getFileName().toString().equals("Main" + suffix))
          .findFirst()
          .orElseThrow(() -> new AssertionError("Alpha.Main's IR cache was written"));
    }
  }

  /**
   * Rewrites a `ModuleCache` metadata file as if it recorded no other libraries' hashes, keeping
   * the modules it names. See {@code LibraryDependencies.write}.
   */
  private static void dropLibraryHashes(Path meta) throws IOException {
    var out = new java.io.ByteArrayOutputStream();
    try (var in = new DataInputStream(Files.newInputStream(meta));
        var dos = new DataOutputStream(out)) {
      for (var i = 0; i < 3; i++) {
        dos.writeUTF(in.readUTF()); // source digest, blob digest, compilation stage
      }
      dos.writeInt(in.readInt()); // LibraryDependencies.FORMAT
      var libraries = in.readInt();
      assertTrue("Alpha.Main records Beta", libraries > 0);
      for (var i = 0; i < libraries * 3; i++) {
        in.readUTF();
      }
      dos.writeInt(0);
      var modules = in.readInt();
      assertTrue("Alpha.Main records the modules it names", modules > 0);
      dos.writeInt(modules);
      for (var i = 0; i < modules; i++) {
        dos.writeUTF(in.readUTF());
      }
    }
    Files.write(meta, out.toByteArray());
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
    assertEquals(Map.of("Proj.Main", false, "Alpha.Main", true, "Beta.Main", true), loaded);
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
    return runProject(root.resolve("Proj"), inContext);
  }

  /** `enso --run` of the project at {@code projectRoot}. */
  private long runProject(Path projectRoot, Consumer<EnsoContext> inContext) {
    try (var ctx = builder(projectRoot).build()) {
      var polyCtx = new PolyglotContext(ctx.context());
      var mainMod = polyCtx.evalModule(projectRoot.resolve("src").resolve("Main.enso").toFile());
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
