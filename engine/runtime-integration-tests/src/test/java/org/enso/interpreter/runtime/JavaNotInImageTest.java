package org.enso.interpreter.runtime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.File;
import java.nio.file.Files;
import org.enso.pkg.Package;
import org.enso.pkg.PackageManager;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * The decision behind Note [A Library's Java Must Be In The Native Image]: under the native image a
 * library that is not AOT ready gets the error, and nothing else does. The native branch cannot run
 * on the JVM, so this checks the decision with {@code aot} passed in; a run of the native launcher
 * is what shows the error reaching the user.
 */
public class JavaNotInImageTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private Package<File> library(String namespace, String name) throws Exception {
    var root = tmp.newFolder(name);
    Files.writeString(
        root.toPath().resolve("package.yaml"),
        "name: " + name + "\nnamespace: " + namespace + "\nversion: 0.0.0-dev\n");
    return PackageManager.Default().fromDirectory(root).get();
  }

  @Test
  public void aLibraryNotInTheImageFailsUnderNative() throws Exception {
    var image = library("Standard", "Image");
    assertEquals(
        "Standard.Image's Java is not part of the native engine. Run on the JVM: `enso --jvm`,"
            + " `jvm: true` in package.yaml, or `ENSO_ENGINE_MODE=jvm` in the IDE.",
        EnsoPolyglotJava.javaNotInImage(true, image));
  }

  @Test
  public void everyLibraryLoadsOnTheJvm() throws Exception {
    assertNull(EnsoPolyglotJava.javaNotInImage(false, library("Standard", "Image")));
  }

  @Test
  public void codeOutsideALibraryIsNotRefused() {
    assertNull(EnsoPolyglotJava.javaNotInImage(true, null));
  }
}
