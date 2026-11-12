package org.enso.os.environment.jni;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.Random;
import org.enso.jvm.channel.JVM;
import org.junit.Test;

public class LoadClassTest {
  private static final int MAX = 3000;
  private static final int MIN = 300;
  private static final String PATH = System.getProperty("java.home");
  // set from TestCollectorFeature
  public static String MODULE_PATH;

  private static JVM impl;

  private static JVM jvm() {
    if (impl == null) {
      assert MODULE_PATH != null : "MODULE_PATH field must be set!";
      var path = new File(PATH);
      assert path.isDirectory() : "Java home exists: " + path;
      impl =
          JVM.create(
              path,
              "--module-path=" + MODULE_PATH,
              "--enable-native-access=org.enso.os.environment",
              "-Djdk.module.main=org.enso.os.environment",
              "-Dsay=Ahoj");
    }
    return impl;
  }

  /*
   * Note [A HotSpot JVM Breaks The Test Image On Windows]
   * ====================================================
   * After a HotSpot JVM has run in this test image's process on Windows, the image's own file I/O
   * fails ("The handle is invalid", "Invalid access to memory location", or a crash), so every
   * later test in the run fails. A likely cause: the image exports the JDK libraries it links
   * statically (`JNI_OnLoad_java`, `JNI_OnLoad_nio` and their `Java_*` functions), and HotSpot
   * takes them for its own built-in libraries. Until A1 (#675) a channel test (`Channel.create`)
   * started the JVM first, which hid the problem. So `executeMainClass` runs in a test image of its
   * own. The native launcher does not meet it: once it starts the JVM, no image code runs again.
   */
  private static final String IN_CHILD = "ENSO_LOAD_CLASS_TEST_CHILD";

  @Test
  public void executeMainClass() throws Exception {
    if (System.getenv(IN_CHILD) == null) {
      var self = ProcessHandle.current().info().command().orElseThrow();
      var pb = new ProcessBuilder(self, "executeMainClass").redirectErrorStream(true);
      pb.environment().put(IN_CHILD, "true");
      var p = pb.start();
      var output = new String(p.getInputStream().readAllBytes());
      assertEquals("executeMainClass in " + self + " succeeds:\n" + output, 0, p.waitFor());
      assertTrue(output, output.contains("Number of tests: 1"));
      return;
    }
    var out = File.createTempFile("check-main", ".log");
    var gen = new Random();
    for (var i = 0; i < 5; i++) {
      var n = gen.nextInt(MIN, MAX);
      jvm().executeMain("org/enso/os/environment/jni/TestMain", out.getPath(), "" + n);
      var content = Files.readString(out.toPath());
      assertEquals("Factorial of " + n + " is the same", TestMain.factorial(n).toString(), content);
      out.delete();
    }
  }

  @Test
  public void loadFromDynamicLibrary() throws Exception {
    var libPath = System.getenv("OS_ENVIRONMENT_LIB");
    var libFile = new File(libPath);
    assert libFile.isFile() : "Library file must exists at " + libPath;
    var nativeJvm = JVM.create(libFile);
    var tmp = File.createTempFile("nativelib", ".msg");
    var hello = "Hello from native lib!";
    nativeJvm.executeMain("org/enso/os/environment/lib/HelloTitle", tmp.getAbsolutePath(), hello);
    var content = Files.readString(tmp.toPath());
    tmp.delete();
    assertEquals("Proper message has been written into " + tmp, hello, content);
  }
}
