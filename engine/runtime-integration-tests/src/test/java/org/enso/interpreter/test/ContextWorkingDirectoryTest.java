package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.nio.file.Path;
import java.util.List;
import org.enso.common.ContextFactory;
import org.enso.test.utils.ContextUtils;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * A standby engine's process runs in the temporary directory; its context's working directory is
 * the project's parent (`ContextFactory.workingDirectory`). Relative files, the current directory
 * and processes started without a directory must follow the context, as they follow the process in
 * a normal engine.
 */
public class ContextWorkingDirectoryTest {
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private static final String CODE =
      """
      from Standard.Base import all
      import Standard.Base.System.Platform
      import Standard.Base.System.Process

      main =
          relative = File.new "data/a.csv" . path
          current = File.current_directory . absolute . normalize . path
          pwd = if Platform.os == Platform.OS.Windows then Process.run "cmd" ["/c", "cd"] else Process.run "pwd"
          [relative, current, pwd.stdout.trim]
      """;

  /**
   * `main`'s three texts, in a context whose working directory is `dir` (the process's when null).
   * `standby` sets the property a standby engine sets (`Main.runStandby`), which is what makes the
   * context's directory count.
   */
  private static List<String> run(Path dir, boolean standby) {
    var builder = ContextUtils.newBuilder("enso");
    if (dir != null) {
      builder = builder.withModifiedContext(b -> b.currentWorkingDirectory(dir));
    }
    if (standby) {
      System.setProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY, dir.toString());
    }
    try (var ctx = builder.build()) {
      var result = ctx.evalModule(CODE);
      return List.of(
          result.getArrayElement(0).asString(),
          result.getArrayElement(1).asString(),
          result.getArrayElement(2).asString());
    } finally {
      System.clearProperty(ContextFactory.WORKING_DIRECTORY_PROPERTY);
    }
  }

  @Test
  public void relativePathsAndProcessesFollowTheContextsWorkingDirectory() throws Exception {
    var dir = tmp.newFolder("context-cwd").toPath().toRealPath();
    assertNotEquals(dir, Path.of("").toRealPath());
    var texts = run(dir, true);
    assertEquals(dir.resolve("data").resolve("a.csv").toString(), texts.get(0));
    assertEquals(dir.toString(), texts.get(1));
    assertEquals(dir, Path.of(texts.get(2)).toRealPath());
  }

  @Test
  public void aNormalContextIsUnchanged() throws Exception {
    var texts = run(null, false);
    assertEquals(Path.of("data", "a.csv").toString(), texts.get(0));
    assertEquals(Path.of("").toAbsolutePath().normalize().toString(), texts.get(1));
    assertEquals(Path.of("").toRealPath(), Path.of(texts.get(2)).toRealPath());
  }

  @Test
  public void aWorkingDirectoryWithoutTheStandbyPropertyChangesNoFile() throws Exception {
    // A context given a directory by something other than a standby engine (as the warm-up's is):
    // files keep their relative path, as in a normal engine.
    var dir = tmp.newFolder("not-standby").toPath().toRealPath();
    var texts = run(dir, false);
    assertEquals(Path.of("data", "a.csv").toString(), texts.get(0));
  }
}
