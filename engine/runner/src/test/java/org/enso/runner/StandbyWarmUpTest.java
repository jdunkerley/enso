package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.rules.Timeout;

/**
 * The warm-up's own run is exercised end to end by `StandbyProcessTest` (it needs a built standard
 * library); this covers the cancel that comes before it starts, and the deletion afterwards.
 */
public class StandbyWarmUpTest {
  @Rule public final TemporaryFolder temporary = new TemporaryFolder();
  @Rule public final Timeout timeout = Timeout.seconds(30);

  private static List<Path> children(Path directory) throws IOException {
    try (var files = Files.list(directory)) {
      return files.toList();
    }
  }

  @Test
  public void aCancelBeforeTheRunSkipsTheWarmUp() throws Exception {
    var parent = temporary.newFolder().toPath();
    var warmUp = new StandbyWarmUp(parent, null);
    warmUp.cancel();
    warmUp.run();
    assertEquals("no project was made", List.of(), children(parent));
  }

  @Test
  public void aSecondCancelIsHarmless() throws Exception {
    var parent = temporary.newFolder().toPath();
    var warmUp = new StandbyWarmUp(parent, null);
    warmUp.cancel();
    warmUp.cancel();
    warmUp.run();
    warmUp.cancel();
    assertEquals(List.of(), children(parent));
  }

  @Test
  public void aFileThatCannotBeDeletedLeavesTheRestDeleted() throws Exception {
    var root = temporary.newFolder().toPath();
    var stuck = Files.createDirectories(root.resolve("a"));
    var held = Files.writeString(stuck.resolve("held.txt"), "x");
    var other = Files.writeString(Files.createDirectories(root.resolve("b")).resolve("f.txt"), "y");
    var windows = System.getProperty("os.name").toLowerCase().contains("windows");
    var bytes = new ByteArrayOutputStream();
    var err = new PrintStream(bytes, true, StandardCharsets.UTF_8);
    int failures;
    if (windows) {
      // An open `FileInputStream` keeps its file from being deleted on Windows.
      try (var in = new FileInputStream(held.toFile())) {
        failures = StandbyWarmUp.deleteRecursively(root, err);
      }
    } else {
      // A folder without write permission keeps its files.
      Files.setPosixFilePermissions(stuck, PosixFilePermissions.fromString("r-xr-xr-x"));
      try {
        failures = StandbyWarmUp.deleteRecursively(root, err);
      } finally {
        Files.setPosixFilePermissions(stuck, PosixFilePermissions.fromString("rwxr-xr-x"));
      }
    }
    assertFalse("the other folder is deleted", Files.exists(other.getParent()));
    assertTrue("the held file is left", Files.exists(held));
    assertTrue(failures > 0);
    var warning = bytes.toString(StandardCharsets.UTF_8);
    assertTrue(warning, warning.startsWith("standby: warning: could not delete "));
    assertEquals(warning, 1, warning.lines().count());
  }
}
