package org.enso.interpreter.caches;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
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
