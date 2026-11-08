package org.enso.runner;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.rules.Timeout;

/**
 * The warm-up's own run is exercised end to end by `StandbyProcessTest` (it needs a built standard
 * library); this covers the cancel that comes before it starts.
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
    var warmUp = new StandbyWarmUp(parent);
    warmUp.cancel();
    warmUp.run();
    assertEquals("no project was made", List.of(), children(parent));
  }

  @Test
  public void aSecondCancelIsHarmless() throws Exception {
    var parent = temporary.newFolder().toPath();
    var warmUp = new StandbyWarmUp(parent);
    warmUp.cancel();
    warmUp.cancel();
    warmUp.run();
    warmUp.cancel();
    assertEquals(List.of(), children(parent));
  }
}
