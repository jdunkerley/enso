package org.enso.runner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;
import org.enso.common.ProcessEnvironment;
import org.junit.After;
import org.junit.Test;

public class StandbyRequestTest {
  @After
  public void clear() {
    System.clearProperty("language-server.ydoc.port");
    System.clearProperty("language-server.channel-token");
    System.clearProperty(ProcessEnvironment.PROPERTY_PREFIX + "ENSO_LOCAL_PROJECT_ID");
  }

  @Test
  public void parsesTheArgumentsAndTheEnvironment() {
    var request =
        StandbyRequest.parse(
            "{\"args\":[\"--server\",\"--path\",\"C:\\\\Users\\\\A B\\\\P\",\"\\u00e9\"],"
                + "\"env\":{\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"t\"}}");
    assertEquals(List.of("--server", "--path", "C:\\Users\\A B\\P", "é"), request.args());
    assertEquals(Map.of("LANGUAGE_SERVER_CHANNEL_TOKEN", "t"), request.env());
  }

  @Test
  public void theEnvironmentIsOptional() {
    var request = StandbyRequest.parse(" { \"args\" : [ ] } ");
    assertEquals(List.of(), request.args());
    assertEquals(Map.of(), request.env());
  }

  @Test
  public void refusesAVariableItCannotApply() {
    var e =
        assertThrows(
            IllegalArgumentException.class,
            () -> StandbyRequest.parse("{\"args\":[],\"env\":{\"PATH\":\"x\"}}"));
    assertTrue(e.getMessage(), e.getMessage().contains("PATH"));
  }

  @Test
  public void refusesWhatIsNotTheLine() {
    for (var line :
        List.of(
            "[\"--server\"]",
            "{\"args\":[1]}",
            "{\"args\":[],\"other\":[]}",
            "{\"args\":[]} x",
            "{\"args\":[\"unterminated]}",
            "{\"args\":[],\"args\":[]}")) {
      assertThrows(line, IllegalArgumentException.class, () -> StandbyRequest.parse(line));
    }
  }

  @Test
  public void appliesTheEnvironmentAsProperties() {
    StandbyRequest.parse(
            "{\"args\":[],\"env\":{\"LANGUAGE_SERVER_YDOC_PORT\":\"1234\","
                + "\"LANGUAGE_SERVER_CHANNEL_TOKEN\":\"tok\",\"ENSO_LOCAL_PROJECT_ID\":\"key-1\"}}")
        .applyEnvironment();
    assertEquals("1234", System.getProperty("language-server.ydoc.port"));
    assertEquals("tok", System.getProperty("language-server.channel-token"));
    assertEquals("key-1", ProcessEnvironment.get("ENSO_LOCAL_PROJECT_ID"));
  }
}
