package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class StandbyPreloaderTest {
  @Test
  public void anAotCacheMeansNoPreloading() {
    assertTrue(StandbyPreloader.aotCacheInUse(List.of("-Dx=1", "-XX:AOTCache=C:\\a\\enso.aot")));
    assertTrue(StandbyPreloader.aotCacheInUse(List.of("-XX:SharedArchiveFile=/a/enso.jsa")));
    assertFalse(StandbyPreloader.aotCacheInUse(List.of("-XX:-UseJVMCICompiler")));
    var preloader =
        new StandbyPreloader(
            List.of("-XX:AOTCache=/a/enso.aot"),
            List.of("java.lang.String"),
            ClassLoader.getSystemClassLoader());
    assertEquals(
        "preloading skipped: the AOT cache holds the classes", preloader.preload(() -> false));
  }

  @Test
  public void loadsWhatItFindsAndCountsTheRest() {
    var preloader =
        new StandbyPreloader(
            List.of(),
            List.of("java.lang.String", "org.enso.does.not.Exist", "java.util.ArrayList"),
            ClassLoader.getSystemClassLoader());
    assertEquals("preloaded 2 of 3 classes", preloader.preload(() -> false));
  }

  @Test
  public void stopsWhenAbandoned() {
    var preloader =
        new StandbyPreloader(
            List.of(), List.of("java.lang.String"), ClassLoader.getSystemClassLoader());
    assertEquals("preloaded 0 of 1 classes (abandoned)", preloader.preload(() -> true));
  }

  @Test
  public void theListIsThereAndHoldsNoGeneratedClasses() throws Exception {
    var names = StandbyPreloader.listedClasses();
    assertTrue("the generated list is not empty", names.size() > 1000);
    for (var name : names) {
      assertFalse(name, name.contains("$$Lambda") || name.contains("/0x"));
    }
  }
}
