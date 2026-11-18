package org.enso.interpreter.runtime.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import scala.Option;

/**
 * Paths in diagnostics must not depend on the working directory (#872): during standard library
 * indexing it is {@code lib/Standard/<Library>}, not the repository root.
 */
public class RepositoryFinderTest {
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private static final String BUILT =
      "built-distribution/enso-engine-1.0-linux-amd64/enso-1.0/lib/Standard/Database/0.0.0-dev/"
          + "src/Main.enso";

  @Test
  public void pathOutsideRepositoryStaysAbsolute() throws IOException {
    var root = tmp.newFolder("repo").toPath().toRealPath();
    var other = tmp.newFolder("other").toPath().toRealPath().resolve("a.enso");
    assertEquals(other, RepositoryFinder$.MODULE$.rewritePath(Option.apply(root), other));
    assertEquals(other, RepositoryFinder$.MODULE$.displayPath(Option.apply(root), other));
  }

  @Test
  public void rewrittenPathIsResolvedAgainstRepositoryRootNotCwd() throws IOException {
    var root = tmp.newFolder("repo").toPath().toRealPath();
    var src = root.resolve("distribution/lib/Standard/Database/0.0.0-dev/src");
    Files.createDirectories(src);
    Files.writeString(src.resolve("Main.enso"), "");
    var built = root.resolve(BUILT);

    var rel = RepositoryFinder$.MODULE$.rewritePath(Option.apply(root), built);
    assertEquals(Path.of("distribution/lib/Standard/Database/0.0.0-dev/src/Main.enso"), rel);

    var shown = RepositoryFinder$.MODULE$.displayPath(Option.apply(root), built);
    assertTrue(shown.isAbsolute());
    assertEquals(src.resolve("Main.enso"), shown);
  }

  @Test
  public void missingSourceKeepsTheBuiltDistributionPath() throws IOException {
    var root = tmp.newFolder("repo").toPath().toRealPath();
    var built = root.resolve(BUILT);
    assertEquals(Path.of(BUILT), RepositoryFinder$.MODULE$.rewritePath(Option.apply(root), built));
    assertEquals(built, RepositoryFinder$.MODULE$.displayPath(Option.apply(root), built));
  }
}
