package org.enso.os.environment;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.enso.common.Platform;
import org.junit.Test;

/** Note [Arguments Outside The ANSI Code Page] in {@code WindowsArguments}. */
public class WindowsArgumentsTest {
  private static final String POLISH = "C:\\Users\\\u0141ukasz\\My Project";
  private static final String CJK = "\u6f22\u5b57";

  @Test
  public void recoversTheTailOfTheWideCommandLine() {
    var original = new String[] {"--run", "C:\\Users\\?ukasz\\My Project", "??"};
    var wide = List.of("java.exe", "-Dx=1", "-m", "m/c", "--run", POLISH, CJK);
    assertArrayEquals(
        new String[] {"--run", POLISH, CJK}, WindowsArguments.recover(original, wide));
  }

  @Test
  public void keepsTheArgumentsWhenTheTailDoesNotMatch() {
    var original = new String[] {"--run", "C:\\Users\\?ukasz"};
    // A different ASCII character, a different length, or an ASCII character behind the `?`.
    for (var other :
        List.of("C:\\Users\\\u0141ukasy", "C:\\Users\\\u0141ukasz2", "C:\\Users\\Lukasz")) {
      var wide = List.of("java.exe", "--run", other);
      assertSame(original, WindowsArguments.recover(original, wide));
    }
    var differentOption = List.of("java.exe", "--new", "C:\\Users\\\u0141ukasz");
    assertSame(original, WindowsArguments.recover(original, differentOption));
  }

  @Test
  public void recoversASystemProperty() {
    var wide =
        List.of(
            "java.exe", "-Denso.user.dir=C:\\old", "-Denso.user.dir=" + POLISH, "-m", "m/c", "x");
    assertEquals(
        POLISH,
        WindowsArguments.recoverProperty("enso.user.dir", "C:\\Users\\?ukasz\\My Project", wide));
    assertEquals(
        "C:\\Users\\?other",
        WindowsArguments.recoverProperty("enso.user.dir", "C:\\Users\\?other", wide));
    assertEquals(
        "C:\\Users\\?ukasz",
        WindowsArguments.recoverProperty("other.dir", "C:\\Users\\?ukasz", wide));
  }

  @Test
  public void keepsTheArgumentsWhenTheWideLineIsTooShort() {
    var original = new String[] {"a?", "b"};
    assertSame(original, WindowsArguments.recover(original, List.of("a\u0141", "b")));
  }

  @Test
  public void aSurrogatePairIsOneQuestionMark() {
    var emoji = new String(Character.toChars(0x1f600));
    var original = new String[] {"x?y"};
    assertArrayEquals(
        new String[] {"x" + emoji + "y"},
        WindowsArguments.recover(original, List.of("java.exe", "x" + emoji + "y")));
  }

  /** A real {@code java.exe}: the arguments reach {@code main} intact. */
  @Test
  public void javaExeArgumentsSurviveOnWindows() throws Exception {
    assumeTrue(Platform.getOperatingSystem().isWindows());
    var classPath = new ArrayList<String>();
    for (var c : List.of(WindowsArguments.class, Platform.class, PrintArguments.class)) {
      var location = c.getProtectionDomain().getCodeSource().getLocation().toURI();
      classPath.add(Path.of(location).toString());
    }
    var java = Path.of(System.getProperty("java.home"), "bin", "java.exe").toString();
    var args = List.of(POLISH, CJK, "plain", "with?mark");
    var command = new ArrayList<String>();
    command.add(java);
    command.add("--enable-native-access=ALL-UNNAMED");
    command.add("-Denso.user.dir=" + CJK);
    command.add("-cp");
    command.add(String.join(File.pathSeparator, classPath));
    command.add(PrintArguments.class.getName());
    command.addAll(args);
    var process = new ProcessBuilder(command).redirectErrorStream(true).start();
    var output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertTrue(process.waitFor(60, TimeUnit.SECONDS));
    assertEquals(output, 0, process.exitValue());
    var expected = new StringBuilder();
    for (var a : args) {
      expected.append(PrintArguments.codePoints(a)).append(System.lineSeparator());
    }
    expected.append(PrintArguments.codePoints(CJK)).append(System.lineSeparator());
    assertEquals(expected.toString(), output);
  }
}
