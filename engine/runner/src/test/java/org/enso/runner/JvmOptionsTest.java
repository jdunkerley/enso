package org.enso.runner;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class JvmOptionsTest {
  @Rule public TemporaryFolder folder = new TemporaryFolder();

  private File component() throws Exception {
    var root = folder.newFolder("dist");
    var component = new File(root, "component");
    component.mkdirs();
    return component;
  }

  @Test
  public void readsTheFileBesideComponent() throws Exception {
    var component = component();
    Files.writeString(
        new File(component.getParentFile(), "jvm.options").toPath(),
        "# tuned for the open\n-Dpolyglot.engine.Mode=latency\n\n  -XX:CICompilerCount=2  \n");
    assertEquals(
        List.of("-Dpolyglot.engine.Mode=latency", "-XX:CICompilerCount=2"),
        JvmOptions.fromFile(component));
  }

  @Test
  public void noFileGivesNothing() throws Exception {
    assertEquals(List.of(), JvmOptions.fromFile(component()));
  }

  @Test
  public void environmentSplitsOnWhitespace() {
    assertEquals(List.of("-Da=1", "-Db=2"), JvmOptions.fromEnvironment("  -Da=1   -Db=2 "));
    assertEquals(List.of(), JvmOptions.fromEnvironment(null));
    assertEquals(List.of(), JvmOptions.fromEnvironment("  "));
  }

  @Test
  public void environmentWithNewlinesKeepsSpacesInsideAnOption() {
    var value =
        "-XX:AOTCache=C:\\Users\\John Smith\\enso.aot\r\n"
            + "-Xlog:aot=warning,cds=warning:file=\"C:\\Users\\John Smith\\use.log\"\n\n";
    assertEquals(
        List.of(
            "-XX:AOTCache=C:\\Users\\John Smith\\enso.aot",
            "-Xlog:aot=warning,cds=warning:file=\"C:\\Users\\John Smith\\use.log\""),
        JvmOptions.fromEnvironment(value));
  }

  @Test
  public void byteOrderMarkIsIgnored() throws Exception {
    var component = component();
    var bom = String.valueOf((char) 0xFEFF);
    Files.writeString(
        new File(component.getParentFile(), "jvm.options").toPath(), bom + "# comment\n-Da=1\n");
    assertEquals(List.of("-Da=1"), JvmOptions.fromFile(component));
    assertEquals(List.of("-Db=2"), JvmOptions.fromEnvironment(bom + "-Db=2\n"));
  }

  @Test
  public void fileComesBeforeEnvironment() throws Exception {
    var component = component();
    Files.writeString(new File(component.getParentFile(), "jvm.options").toPath(), "-Dfrom=file\n");
    assertEquals(List.of("-Dfrom=file", "-Dfrom=env"), JvmOptions.all(component, "-Dfrom=env"));
  }
}
