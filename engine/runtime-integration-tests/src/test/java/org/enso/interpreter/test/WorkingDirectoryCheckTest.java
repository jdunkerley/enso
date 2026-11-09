package org.enso.interpreter.test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import org.enso.common.ContextFactory;
import org.enso.common.LanguageInfo;
import org.enso.common.RuntimeOptions;
import org.enso.test.utils.ProjectUtils;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.PolyglotException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A standby engine starts before its project is known, so its process's working directory is not
 * the project's parent. The runner gives the context the project's parent as its working directory
 * instead (`ContextFactory.workingDirectory`), and `EnsoContext.checkWorkingDirectory` compares
 * against that: it passes, and a wrong one still fails.
 */
public class WorkingDirectoryCheckTest {
  private static final String UNEXPECTED = "unexpected working directory";

  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private final List<LogRecord> records = new ArrayList<>();
  private final Handler handler =
      new Handler() {
        @Override
        public void publish(LogRecord record) {
          synchronized (records) {
            records.add(record);
          }
        }

        @Override
        public void flush() {}

        @Override
        public void close() {}
      };

  private Path newProject() throws Exception {
    var project = tmp.newFolder("projects", "Wd_Test").toPath();
    ProjectUtils.createProject("Wd_Test", "main = 42", project);
    return project;
  }

  private Context context(Path project, Path workingDirectory) {
    return ContextFactory.create()
        .projectRoot(project.toString())
        .workingDirectory(workingDirectory.toString())
        .logLevel(Level.WARNING)
        .logHandler(handler)
        .options(
            Map.of(
                RuntimeOptions.LANGUAGE_HOME_OVERRIDE,
                Paths.get("../../distribution/component").toFile().getAbsolutePath()))
        .build();
  }

  /**
   * Whether initialising `ctx` reported the unexpected working directory (a warning, or with -ea an
   * error).
   */
  private boolean complains(Context ctx) {
    try {
      ctx.initialize(LanguageInfo.ID);
    } catch (PolyglotException e) {
      if (String.valueOf(e.getMessage()).contains(UNEXPECTED)) {
        return true;
      }
      throw e;
    }
    synchronized (records) {
      return records.stream().anyMatch(r -> String.valueOf(r.getMessage()).contains(UNEXPECTED));
    }
  }

  @Test
  public void theProjectsParentAsTheContextsWorkingDirectoryPasses() throws Exception {
    var project = newProject();
    var parent = project.getParent();
    assertNotEquals(
        "the process must not already run in the project's parent",
        parent.toRealPath(),
        Path.of("").toRealPath());
    try (var ctx = context(project, parent)) {
      assertFalse("no complaint about the working directory", complains(ctx));
    }
  }

  @Test
  public void anotherWorkingDirectoryStillFails() throws Exception {
    var project = newProject();
    var elsewhere = Files.createDirectories(tmp.getRoot().toPath().resolve("elsewhere"));
    try (var ctx = context(project, elsewhere)) {
      assertTrue("the check still reports a wrong directory", complains(ctx));
    }
  }
}
