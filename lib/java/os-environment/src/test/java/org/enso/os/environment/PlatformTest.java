package org.enso.os.environment;

import org.enso.common.Platform;
import org.enso.os.environment.directories.Directories;
import org.junit.Assert;
import org.junit.Test;

public class PlatformTest {

  @Test
  public void getOperatingSystem() {
    Assert.assertNotNull(Platform.getOperatingSystem());
  }

  @Test
  public void getDirectories() {
    Assert.assertNotNull(Directories.getCurrent());
  }
}
