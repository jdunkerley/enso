package org.enso.compiler.test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import org.enso.common.LanguageInfo;
import org.enso.common.MethodNames;
import org.enso.common.RuntimeOptions;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.pkg.PackageManager;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.io.IOAccess;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * Import resolution and module loading share one read of a library's bindings cache. See Note [One
 * Bindings Cache Read Per Library] in {@code TruffleCompilerContext}.
 */
public class LibraryBindingsReadOnceTest {
  static final String RESTORED = "Restored bindings for library [{0}].";

  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  @Test
  public void eachLibrarysBindingsCacheIsReadOnce() throws Exception {
    var pkgPath = persistedCopyOf("Fib_Test", tmp.getRoot().toPath());
    var pkg = PackageManager.Default().fromDirectory(pkgPath).get();

    var records = Collections.synchronizedList(new ArrayList<LogRecord>());
    try (var ctx = ensoContextForPackage(pkgPath, false, new KeepingHandler(records))) {
      var ensoContext = leakContext(ctx);
      var module = ensoContext.getModuleForFile(pkg.mainFile()).get().asCompilerModule();
      ctx.enter();
      try {
        ensoContext.getCompiler().run(module);
      } finally {
        ctx.leave();
      }
    }

    List<String> restored;
    synchronized (records) {
      restored =
          records.stream()
              .filter(r -> RESTORED.equals(r.getMessage()))
              .map(r -> String.valueOf(r.getParameters()[0]))
              .toList();
    }
    assertTrue(
        "Fib_Test's bindings are restored: " + restored, restored.contains("local.Fib_Test"));
    for (var library : new HashSet<>(restored)) {
      assertEquals(
          library + "'s bindings cache is read once: " + restored,
          1,
          Collections.frequency(restored, library));
    }
  }

  /**
   * Copies the test project {@code projectName} into {@code into} and persists its module and
   * bindings caches there, as {@code SerdeCompilerTest.parseSerializedModule} does.
   */
  public static File persistedCopyOf(String projectName, Path into) throws Exception {
    var source =
        new File(
                LibraryBindingsReadOnceTest.class.getClassLoader().getResource(projectName).toURI())
            .toPath();
    var target = into.resolve(projectName);
    try (var files = Files.walk(source)) {
      for (var from : (Iterable<Path>) files::iterator) {
        var to = target.resolve(source.relativize(from).toString());
        if (Files.isDirectory(from)) {
          Files.createDirectories(to);
        } else {
          Files.copy(from, to);
        }
      }
    }
    var pkgPath = target.toFile();
    var pkg = PackageManager.Default().fromDirectory(pkgPath).get();
    try (var ctx = ensoContextForPackage(pkgPath, true, null)) {
      var ensoContext = leakContext(ctx);
      var module = ensoContext.getModuleForFile(pkg.mainFile()).get().asCompilerModule();
      var compiler = ensoContext.getCompiler();
      ctx.enter();
      try {
        var result = compiler.run(module);
        var futures = new ArrayList<Future<Boolean>>();
        result
            .compiledModules()
            .filter((m) -> !m.isSynthetic())
            .foreach(
                (m) -> {
                  futures.add(compiler.context().serializeModule(compiler, m, true));
                  return null;
                });
        futures.add(compiler.compile(false, true, scala.Option.empty()));
        for (var f : futures) {
          assertEquals(
              projectName + " has been fully persisted", true, f.get(30, TimeUnit.SECONDS));
        }
      } finally {
        ctx.leave();
      }
    }
    return pkgPath;
  }

  public static EnsoContext leakContext(Context ctx) {
    return (EnsoContext)
        ctx.getBindings(LanguageInfo.ID)
            .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
            .asHostObject();
  }

  /**
   * As {@code SerdeCompilerTest.ensoContextForPackage}, with the serialization manager's log (where
   * "Restored bindings" is written) at {@code FINE} when a handler is given.
   */
  public static Context ensoContextForPackage(
      File pkgFile, boolean disableIrCaching, Handler handler) throws IOException {
    var builder =
        Context.newBuilder()
            .allowExperimentalOptions(true)
            .allowIO(IOAccess.ALL)
            .option(RuntimeOptions.PROJECT_ROOT, pkgFile.getAbsolutePath())
            .option(RuntimeOptions.DISABLE_IR_CACHES, "" + disableIrCaching)
            .option(
                RuntimeOptions.LANGUAGE_HOME_OVERRIDE,
                Paths.get("../../distribution/component").toFile().getAbsolutePath())
            .option(RuntimeOptions.LOG_LEVEL, Level.WARNING.getName())
            .option(RuntimeOptions.CHECK_CWD, "false")
            .allowAllAccess(true);
    if (handler != null) {
      builder
          .logHandler(handler)
          .option("log.enso.org.enso.interpreter.runtime.SerializationPool.level", "FINE");
    }
    var ctx = builder.build();
    assertNotNull("Enso language is supported", ctx.getEngine().getLanguages().get("enso"));
    return ctx;
  }

  /** Keeps every record it is given. */
  static final class KeepingHandler extends Handler {
    private final List<LogRecord> records;

    KeepingHandler(List<LogRecord> records) {
      this.records = records;
    }

    @Override
    public void publish(LogRecord lr) {
      records.add(lr);
    }

    @Override
    public void flush() {}

    @Override
    public void close() {}
  }
}
