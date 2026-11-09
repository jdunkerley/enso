package org.enso.common;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Test;

public class ProcessEnvironmentTest {
  private static final String HANDED = ProcessEnvironment.PROPERTY_PREFIX + "PATH";

  @After
  public void clear() {
    System.clearProperty(HANDED);
  }

  @Test
  public void aHandedValueWinsOverTheEnvironment() {
    System.setProperty(HANDED, "handed");
    assertEquals("handed", ProcessEnvironment.get("PATH"));
  }

  @Test
  public void withoutAHandedValueTheEnvironmentIsRead() {
    assertEquals(System.getenv("PATH"), ProcessEnvironment.get("PATH"));
  }

  @Test
  public void neitherGivesNull() {
    assertNull(ProcessEnvironment.get("ENSO_TEST_SET_NOWHERE_518"));
  }
}
