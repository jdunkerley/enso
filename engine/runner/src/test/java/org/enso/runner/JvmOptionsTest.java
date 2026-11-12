package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
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

  /**
   * The cases of {@code jvm-options-cases.txt}, which the shim's TypeScript parser (app/
   * project-manager-shim, {@code jvmOptions.test.ts}) is tested against too.
   */
  @Test
  public void sharedCases() throws Exception {
    var cases = SharedCase.read();
    assertTrue("the fixture has cases", cases.size() >= 8);
    var component = component();
    for (var c : cases) {
      if (c.file != null) {
        Files.writeString(new File(component.getParentFile(), "jvm.options").toPath(), c.file);
        assertEquals(c.name + " (file)", c.fileExpect, JvmOptions.fromFile(component));
      }
      if (c.env != null) {
        assertEquals(c.name + " (env)", c.envExpect, JvmOptions.fromEnvironment(c.env));
      }
    }
  }

  private static final class SharedCase {
    final String name;
    String file;
    String env;
    final List<String> fileExpect = new ArrayList<>();
    final List<String> envExpect = new ArrayList<>();

    SharedCase(String name) {
      this.name = name;
    }

    static List<SharedCase> read() throws IOException {
      var result = new ArrayList<SharedCase>();
      try (var in = JvmOptionsTest.class.getResourceAsStream("jvm-options-cases.txt")) {
        assertNotNull("jvm-options-cases.txt", in);
        for (var line : new String(in.readAllBytes(), StandardCharsets.UTF_8).split("\r?\n")) {
          if (line.startsWith("== ")) {
            result.add(new SharedCase(line.substring(3)));
          } else if (line.isEmpty() || line.startsWith("#")) {
            continue;
          } else {
            var current = result.get(result.size() - 1);
            var colon = line.indexOf(": ");
            var key = line.substring(0, colon);
            var value = unescape(line.substring(colon + 2));
            switch (key) {
              case "file" -> current.file = value;
              case "env" -> current.env = value;
              case "file-expect" -> current.fileExpect.add(value);
              case "env-expect" -> current.envExpect.add(value);
              default -> throw new IllegalStateException("unknown key " + key);
            }
          }
        }
      }
      return result;
    }

    private static String unescape(String s) {
      var out = new StringBuilder();
      for (var i = 0; i < s.length(); i++) {
        var ch = s.charAt(i);
        if (ch != '\\') {
          out.append(ch);
          continue;
        }
        var next = s.charAt(++i);
        switch (next) {
          case 'n' -> out.append('\n');
          case 'r' -> out.append('\r');
          case 't' -> out.append('\t');
          case '\\' -> out.append('\\');
          case 'u' -> {
            out.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
            i += 4;
          }
          default -> throw new IllegalStateException("unknown escape \\" + next);
        }
      }
      return out.toString();
    }
  }

  @Test
  public void fileComesBeforeEnvironment() throws Exception {
    var component = component();
    Files.writeString(new File(component.getParentFile(), "jvm.options").toPath(), "-Dfrom=file\n");
    assertEquals(List.of("-Dfrom=file", "-Dfrom=env"), JvmOptions.all(component, "-Dfrom=env"));
  }
}
