package org.enso.os.environment.jni;

import static org.junit.Assert.assertEquals;

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

  @Test
  public void executeMainClass() throws Exception {
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
