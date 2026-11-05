package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Random;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.enso.common.RuntimeOptions;
import org.enso.editions.LibraryName;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.pkg.QualifiedName;
import org.enso.polyglot.PolyglotContext;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A library's caches are keyed by its sources, not by its name and version (#473). Two trees of a
 * library with the same name and version are two checkouts of it: one must not use the other's
 * caches unless their sources are the same. See Note [Library Caches Are Keyed By The Sources] in
 * {@code LibrarySourceHashes}.
 */
public class LibraryCacheDigestTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  /**
   * Unique per run: the IR caches are per user (`ModuleCache`), keyed by the library's name and
   * version, so a fixed name would meet the caches of an earlier run.
   */
  private final String name = "Digested_" + randomWord();

  private final LibraryName library = new LibraryName("local", name);

  /** The per-user IR cache directory of this test's library, deleted after the test. */
  private Path irCacheDir;

  /** Its IR records which module `answer` was found in. */
  private static final String MAIN =
      """
      from project.Helpers import all
      from project.Other import all

      main = answer
      """;

  private static final Map<String, String> FIRST =
      Map.of("Main", MAIN, "Helpers", "answer = 1\n", "Other", "other = 0\n");

  /** The same `Main`, and `answer` moved to the other module. */
  private static final Map<String, String> SECOND =
      Map.of("Main", MAIN, "Helpers", "helper = 0\n", "Other", "answer = 2\n");

  @After
  public void deleteIrCaches() throws IOException {
    if (irCacheDir != null && Files.isDirectory(irCacheDir)) {
      ProjectUtils.deleteRecursively(irCacheDir);
    }
  }

  @Test
  public void otherSourcesDoNotUseTheBindingsCache() throws IOException {
    var first = createLibrary("first", FIRST);
    compile(first);
    assertNotNull("compiling writes the bindings cache", findCacheFile(first, ".bindings.meta"));

    var second = createLibrary("second", SECOND);
    copyCaches(first, second);
    assertEquals(2L, run(second, ctx -> {}));
  }

  @Test
  public void otherSourcesDoNotUseTheSuggestionsCache() throws IOException {
    var first = createLibrary("first", FIRST);
    compile(first);
    var second = createLibrary("second", SECOND);
    copyCaches(first, second);

    run(
        second,
        ctx -> {
          assertFalse(
              "the bindings cache of other sources is not used",
              ImportExportCache.create(library).load(ctx).isPresent());
          assertFalse(
              "the suggestions cache of other sources is not used",
              SuggestionsCache.create(library).load(ctx).isPresent());
        });
  }

  @Test
  public void theSameSourcesStillUseTheCaches() throws IOException {
    var first = createLibrary("first", FIRST);
    compile(first);
    var same = createLibrary("same", FIRST);
    copyCaches(first, same);

    var answer =
        run(
            same,
            ctx -> {
              assertTrue(
                  "the bindings cache of the same sources is used",
                  ImportExportCache.create(library).load(ctx).isPresent());
              assertTrue(
                  "the suggestions cache of the same sources is used",
                  SuggestionsCache.create(library).load(ctx).isPresent());
            });
    assertEquals(1L, answer);
  }

  @Test
  public void aCacheKeyedByTheLibraryNameIsIgnored() throws IOException {
    var first = createLibrary("first", FIRST);
    compile(first);
    // What an engine before #473 wrote: the SHA-1 of the library's name.
    var nameDigest =
        sha1Hex(library.qualifiedName().getBytes(StandardCharsets.UTF_8)); // as `CacheUtils` did
    for (var suffix : new String[] {".bindings.meta", ".suggestions.meta"}) {
      var meta = findCacheFile(first, suffix);
      assertNotNull("compiling writes " + suffix, meta);
      var blobHash = readMetadata(meta)[1];
      writeMetadata(meta, nameDigest, blobHash);
    }

    var answer =
        run(
            first,
            ctx -> {
              assertFalse(
                  "a bindings cache keyed by the name is not used",
                  ImportExportCache.create(library).load(ctx).isPresent());
              assertFalse(
                  "a suggestions cache keyed by the name is not used",
                  SuggestionsCache.create(library).load(ctx).isPresent());
            });
    assertEquals(1L, answer);
  }

  @Test
  public void otherSourcesDoNotShareModuleIR() throws IOException {
    // `Main` is the same in both, so its own digest matches; what it resolved `answer` to does not.
    var first = createLibrary("first", FIRST);
    assertEquals(1L, run(first, ctx -> {}));
    assertTrue(
        "running the first tree writes the IR caches of its modules",
        irCacheDir != null && Files.isDirectory(irCacheDir));

    // As `indexStdLibs` compiles: `--no-compile-dependencies`, so a module loaded from its IR
    // cache is not recompiled because a module it imports was (`Compiler.runInternal`).
    var second = createLibrary("second", SECOND);
    compile(second, false);
    assertEquals(2L, run(second, ctx -> {}));
  }

  /**
   * #584: `Main` is the same in both trees, so its IR cache's own digest matches, but the module
   * its import resolved to is gone from the second, where the same import names a type. Before, the
   * cache was accepted and the import resolution failed later, fatally, with "Cannot deserialize
   * BindingsMap"; now the cache is a miss and `Main` is compiled from source.
   */
  @Test
  public void aCachedModuleNamingAModuleItsLibraryNoLongerHasIsRecompiled() throws IOException {
    var first =
        createLibrary("first", Map.of("Main", SHADOWING_MAIN, "Shapes.Thing", "answer = 1\n"));
    var second =
        createLibrary(
            "second", Map.of("Main", SHADOWING_MAIN, "Shapes", "type Thing\n    answer = 2\n"));
    assertStaleCacheIsNotUsed(first, second, "Main", 1L, 2L);
  }

  /**
   * An import names a module if there is one, and a type otherwise: `project.Shapes.Thing` is
   * either the module `Shapes/Thing.enso` or the type `Thing` in `Shapes`.
   */
  private static final String SHADOWING_MAIN =
      "import project.Shapes.Thing\n\nmain = Thing.answer\n";

  /**
   * The mirror image of the above: a module `Shapes/Thing.enso` is added next to the type `Thing`
   * in an unchanged `Shapes.enso`, which `Main`'s cached IR resolved its import to. Compiled
   * afresh, that is a conflict; from the caches it used to run the old `Thing.answer` silently.
   * `Shapes`'s digest covers the modules in its directory (Note [A Cached Module Follows Its
   * Directory] in {@code ModuleCache}), so `Shapes` is compiled and reports the conflict.
   */
  @Test
  public void aModuleThatNowShadowsAnImportedTypeIsNotHiddenByTheCache() throws IOException {
    var shapes = "type Thing\n    answer = 1\n";
    var first = createLibrary("first", Map.of("Main", SHADOWING_MAIN, "Shapes", shapes));
    assertEquals(1L, run(first, ctx -> {}));
    assertNotNull("the first tree writes Shapes's IR cache", findIrCache("Shapes.meta"));

    var second =
        createLibrary(
            "second",
            Map.of("Main", SHADOWING_MAIN, "Shapes", shapes, "Shapes.Thing", "answer = 2\n"));
    var error = assertThrows(RuntimeException.class, () -> run(second, ctx -> {}));
    assertTrue(error.getMessage(), error.getMessage().contains("Conflicting resolutions"));
  }

  /**
   * A module added to `Shapes/` is exported by `Shapes`, although `Shapes.enso` is unchanged: its
   * cached IR, which does not export it, is not used.
   */
  @Test
  public void aModuleAddedToADirectoryIsExportedByItsCachedParent() throws IOException {
    var shapes = "answer = 1\n";
    var first =
        createLibrary(
            "first",
            Map.of(
                "Main",
                "import project.Shapes\n\nmain = Shapes.answer\n",
                "Shapes",
                shapes,
                "Shapes.Circle",
                "radius = 1\n"));
    var second =
        createLibrary(
            "second",
            Map.of(
                "Main",
                "import project.Shapes\n\nmain = Shapes.Square.side\n",
                "Shapes",
                shapes,
                "Shapes.Circle",
                "radius = 1\n",
                "Shapes.Square",
                "side = 2\n"));
    assertStaleCacheIsNotUsed(first, second, "Shapes", 1L, 2L);
  }

  /**
   * The last resort: a cached `BindingsMap` that names a module that is gone, although its cache's
   * record says nothing of it (here the record is cut by hand), is compiled from source with a
   * warning, not a fatal "Cannot deserialize BindingsMap". See Note [A Cache That Does Not Load Is
   * A Miss] in {@code Cache}.
   */
  @Test
  public void aCachedBindingsMapThatDoesNotResolveIsRecompiled() throws IOException {
    var first =
        createLibrary("first", Map.of("Main", SHADOWING_MAIN, "Shapes.Thing", "answer = 1\n"));
    assertEquals(1L, run(first, ctx -> {}));
    var meta = findIrCache("Main.meta");
    dropRecordedModules(meta);

    var second =
        createLibrary(
            "second", Map.of("Main", SHADOWING_MAIN, "Shapes", "type Thing\n    answer = 2\n"));
    compile(second, false);
    assertEquals(2L, run(second, ctx -> {}));
  }

  /**
   * Runs {@code first}, which writes the IR cache of {@code module}; then runs {@code second},
   * which must not load {@code module} from it; then, after {@code first} has written its cache
   * again, compiles {@code second} as `indexStdLibs` does (where #584 was seen).
   */
  private void assertStaleCacheIsNotUsed(
      Path first, Path second, String module, long firstAnswer, long secondAnswer)
      throws IOException {
    assertEquals(firstAnswer, run(first, ctx -> {}));
    assertNotNull("the first tree writes " + module + "'s IR cache", findIrCache(module + ".meta"));
    var loaded = new boolean[] {true};
    assertEquals(
        secondAnswer,
        run(
            second,
            ctx -> {
              var found = ctx.findModule("local." + name + "." + module);
              loaded[0] = found.isPresent() && found.get().wasLoadedFromCache();
            }));
    assertFalse("the second tree does not load " + module + " from the cache", loaded[0]);

    assertEquals(firstAnswer, run(first, ctx -> {}));
    compile(second, false);
    assertEquals(secondAnswer, run(second, ctx -> {}));
  }

  private Path findIrCache(String fileName) throws IOException {
    if (irCacheDir == null || !Files.isDirectory(irCacheDir)) {
      return null;
    }
    try (var files = Files.walk(irCacheDir)) {
      return files
          .filter(f -> f.getFileName().toString().equals(fileName))
          .findFirst()
          .orElse(null);
    }
  }

  /** Rewrites a `ModuleCache` metadata file as if its IR named no modules. */
  private static void dropRecordedModules(Path meta) throws IOException {
    assertNotNull("the IR cache was written", meta);
    var out = new java.io.ByteArrayOutputStream();
    try (var in = new java.io.DataInputStream(Files.newInputStream(meta));
        var dos = new DataOutputStream(out)) {
      for (var i = 0; i < 3; i++) {
        dos.writeUTF(in.readUTF()); // source digest, blob digest, compilation stage
      }
      dos.writeInt(in.readInt()); // LibraryDependencies.FORMAT
      var libraries = in.readInt();
      dos.writeInt(libraries);
      for (var i = 0; i < libraries * 3; i++) {
        dos.writeUTF(in.readUTF());
      }
      assertTrue("Main records the module it names", in.readInt() > 0);
      dos.writeInt(0);
    }
    Files.write(meta, out.toByteArray());
  }

  /**
   * #584 as `indexStdLibs` met it: `Standard.Base.Data` was unchanged when `Data/XML.enso` moved to
   * `Standard.XML`. A module exports the modules in its directory, so its IR names them although
   * its source does not, and the IR cached by a tree that still had `Data/XML.enso` failed with
   * "Cannot deserialize BindingsMap".
   */
  @Test
  public void aCachedModuleWhoseDirectoryLostAModuleIsRecompiled() throws IOException {
    var main = "import project.Shapes\n\nmain = Shapes.answer\n";
    var shapes = "answer = 1\n";
    var first =
        createLibrary(
            "first", Map.of("Main", main, "Shapes", shapes, "Shapes.Circle", "radius = 1\n"));
    var second =
        createLibrary(
            "second", Map.of("Main", main, "Shapes", shapes, "Shapes.Square", "side = 2\n"));
    assertStaleCacheIsNotUsed(first, second, "Shapes", 1L, 1L);
  }

  @Test
  public void theSameSourcesShareModuleIR() throws IOException {
    var first = createLibrary("first", FIRST);
    assertEquals(1L, run(first, ctx -> {}));
    var same = createLibrary("same", FIRST);
    var loadedFromCache = new boolean[1];
    var answer =
        run(
            same,
            ctx -> {
              var main = ctx.findModule("local." + name + ".Main");
              loadedFromCache[0] = main.isPresent() && main.get().wasLoadedFromCache();
            });
    assertEquals(1L, answer);
    assertTrue("the same sources load Main's IR from its cache", loadedFromCache[0]);
  }

  @Test
  public void editingAModuleRecompilesOnlyItAndItsImporters() throws IOException {
    var modules =
        Map.of(
            "Main",
            """
            from project.Helpers import all
            from project.Other import all

            main = other
            unused = answer
            """,
            "Helpers",
            "answer = 1\n",
            "Other",
            "other = 10\n");
    var root = createLibrary("edited", modules);
    assertEquals(10L, run(root, ctx -> {}));
    assertEquals(
        "an unedited reopen loads every module from its cache",
        Map.of("Main", true, "Helpers", true, "Other", true),
        loadedFromCache(root, 10L));

    Files.writeString(root.resolve("src").resolve("Other.enso"), "other = 20\n");
    assertEquals(
        "the edited module and its importer are recompiled, the other module is not",
        Map.of("Main", false, "Helpers", true, "Other", false),
        loadedFromCache(root, 20L));
    assertEquals(
        "the next reopen loads every module from its cache again",
        Map.of("Main", true, "Helpers", true, "Other", true),
        loadedFromCache(root, 20L));
  }

  /**
   * Note [A Module's Name Does Not Depend On How Its Path Is Spelt] in {@code ProgramRootNode}: a
   * project run through a Windows 8.3 short path still reuses its IR caches.
   */
  @Test
  public void aShortWindowsPathStillUsesTheModuleIR() throws Exception {
    var longRoot = createLibrary("A_Directory_With_A_Long_Name", FIRST);
    var shortRoot = shortWindowsPath(longRoot);
    org.junit.Assume.assumeTrue(
        "needs Windows with 8.3 names", shortRoot != null && !shortRoot.equals(longRoot));
    assertEquals(1L, run(shortRoot, ctx -> {}));
    var loaded = new boolean[1];
    run(
        shortRoot,
        ctx -> {
          var main = ctx.findModule("local." + name + ".Main");
          loaded[0] = main.isPresent() && main.get().wasLoadedFromCache();
        });
    assertTrue("Main's IR is loaded from its cache", loaded[0]);
  }

  /** The 8.3 short form of a path, from `cmd`; {@code null} if there is none. */
  private static Path shortWindowsPath(Path path) throws Exception {
    if (!System.getProperty("os.name").toLowerCase().contains("windows")) {
      return null;
    }
    var process =
        new ProcessBuilder("cmd", "/c", "for %I in (\"" + path + "\") do @echo %~sI")
            .redirectErrorStream(true)
            .start();
    var output = new String(process.getInputStream().readAllBytes()).trim();
    return process.waitFor() == 0 && !output.isEmpty() ? Path.of(output) : null;
  }

  /** Runs the tree, checks `main`, and tells which of its modules were loaded from their caches. */
  private Map<String, Boolean> loadedFromCache(Path root, long expected) {
    var loaded = new java.util.HashMap<String, Boolean>();
    var answer =
        run(
            root,
            ctx -> {
              for (var module : new String[] {"Main", "Helpers", "Other"}) {
                var found = ctx.findModule("local." + name + "." + module);
                loaded.put(module, found.isPresent() && found.get().wasLoadedFromCache());
              }
            });
    assertEquals(expected, answer);
    return loaded;
  }

  private Path createLibrary(String dir, Map<String, String> modules) throws IOException {
    var root = tmp.newFolder(dir).toPath();
    ProjectUtils.createProject(
        name,
        modules.entrySet().stream()
            .map(e -> new SourceModule(QualifiedName.fromString(e.getKey()), e.getValue()))
            .collect(Collectors.toSet()),
        root);
    return root;
  }

  private static ContextUtils.Builder builder(Path root) {
    return ContextUtils.newBuilder()
        .withModifiedContext(
            bldr ->
                bldr.option(RuntimeOptions.DISABLE_IR_CACHES, "false")
                    // The IR caches are written in the background: closing waits for them, so
                    // the next run finds them (without it, CI's slower runners did not).
                    .option(RuntimeOptions.WAIT_FOR_PENDING_SERIALIZATION_JOBS, "true")
                    .option(RuntimeOptions.STRICT_ERRORS, "true"))
        .withProjectRoot(root);
  }

  /** `enso --compile`: writes the library's bindings and suggestions caches. */
  private static void compile(Path root) {
    compile(root, true);
  }

  private static void compile(Path root, boolean compileDependencies) {
    try (var ctx = builder(root).build()) {
      new PolyglotContext(ctx.context()).getTopScope().compile(compileDependencies);
    }
  }

  /**
   * `enso --run`: runs `main`, then hands the context to {@code inContext}.
   *
   * @return what `main` returned
   */
  private long run(Path root, Consumer<EnsoContext> inContext) {
    try (var ctx = builder(root).build()) {
      var polyCtx = new PolyglotContext(ctx.context());
      var mainMod = polyCtx.evalModule(root.resolve("src").resolve("Main.enso").toFile());
      var result = mainMod.getMethod(mainMod.getAssociatedType(), "main").get().execute().asLong();
      var ensoCtx = ctx.ensoContext();
      irCacheDir =
          ensoCtx
              .getDistributionManager()
              .LocallyInstalledDirectories()
              .irCacheDirectory()
              .resolve("local")
              .resolve(name);
      ctx.context().enter();
      try {
        inContext.accept(ensoCtx);
      } finally {
        ctx.context().leave();
      }
      return result;
    }
  }

  /** Copies one tree's `.enso` directory, where its bindings and suggestions caches are. */
  private static void copyCaches(Path from, Path to) throws IOException {
    var source = from.resolve(".enso");
    try (var files = Files.walk(source)) {
      for (var file : (Iterable<Path>) files::iterator) {
        var target = to.resolve(".enso").resolve(source.relativize(file).toString());
        if (Files.isDirectory(file)) {
          Files.createDirectories(target);
        } else {
          Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING);
        }
      }
    }
  }

  private static Path findCacheFile(Path root, String suffix) throws IOException {
    var cache = root.resolve(".enso").resolve("cache");
    if (!Files.isDirectory(cache)) {
      return null;
    }
    try (var files = Files.walk(cache)) {
      return files
          .filter(f -> f.getFileName().toString().endsWith(suffix))
          .findFirst()
          .orElse(null);
    }
  }

  private static String[] readMetadata(Path meta) throws IOException {
    try (var in = new java.io.DataInputStream(Files.newInputStream(meta))) {
      return new String[] {in.readUTF(), in.readUTF()};
    }
  }

  private static void writeMetadata(Path meta, String sourceHash, String blobHash)
      throws IOException {
    try (var out = new DataOutputStream(Files.newOutputStream(meta))) {
      out.writeUTF(sourceHash);
      out.writeUTF(blobHash);
    }
  }

  private static String sha1Hex(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(bytes));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String randomWord() {
    var random = new Random();
    var sb = new StringBuilder();
    sb.append((char) ('A' + random.nextInt(26)));
    for (var i = 0; i < 7; i++) {
      sb.append((char) ('a' + random.nextInt(26)));
    }
    return sb.toString();
  }
}
