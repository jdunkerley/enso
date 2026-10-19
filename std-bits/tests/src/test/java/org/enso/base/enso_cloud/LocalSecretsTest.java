package org.enso.base.enso_cloud;

import static org.junit.Assert.*;

import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class LocalSecretsTest {
  static final String FIXTURE_KEY = LocalSecretStoreTest.FIXTURE_KEY;
  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  @Test
  public void openPrefersTheEnvironmentKeyAndFile() throws Exception {
    var file = tmp.getRoot().toPath().resolve("custom.json");
    var s =
        LocalSecrets.open(
            file.toString(),
            FIXTURE_KEY,
            tmp.getRoot().toPath(),
            () -> {
              throw new AssertionError("keychain must not be read");
            });
    s.create("a", "1");
    assertTrue(Files.exists(file));
  }

  @Test
  public void openFallsBackToHomeAndKeychain() throws Exception {
    var home = tmp.getRoot().toPath();
    var s = LocalSecrets.open(null, null, home, () -> LocalSecretStore.decodeKey(FIXTURE_KEY));
    s.create("a", "1");
    assertTrue(Files.exists(home.resolve(".enso").resolve("secrets.json")));
  }

  @Test
  public void emptyEnvironmentValuesAreUnset() throws Exception {
    var home = tmp.getRoot().toPath();
    var s = LocalSecrets.open("", "", home, () -> LocalSecretStore.decodeKey(FIXTURE_KEY));
    s.create("a", "1");
    assertTrue(Files.exists(home.resolve(".enso").resolve("secrets.json")));
  }

  @Test
  public void withNoKeyAnywhereTheStoreIsLocked() throws Exception {
    var s = LocalSecrets.open(null, null, tmp.getRoot().toPath(), () -> null);
    var e = assertThrows(LocalSecretException.class, () -> s.create("a", "1"));
    assertEquals(LocalSecretException.Kind.LOCKED, e.kind());
  }

  @Test
  public void readSecretResolvesLocalIds() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> null)
        .create("a", "1");
    LocalSecrets.testOverride =
        () -> LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> null);
    try {
      assertEquals("1", EnsoSecretReader.INSTANCE.readSecret("local:a"));
    } finally {
      LocalSecrets.testOverride = null;
    }
  }

  @Test
  public void facadeMessagesCarryTheNameButNeverTheValue() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    LocalSecrets.testOverride =
        () -> LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> null);
    try {
      LocalSecrets.create("x", "hunter2");
      var dup = assertThrows(LocalSecretException.class, () -> LocalSecrets.create("x", "hunter2"));
      assertEquals(LocalSecretException.Kind.ALREADY_EXISTS, dup.kind());
      assertEquals("A secret with the name \"x\" already exists.", dup.getMessage());
      var missing = assertThrows(LocalSecretException.class, () -> LocalSecrets.delete("y"));
      assertEquals("Cannot find secret: secret://y", missing.getMessage());
      assertTrue(LocalSecrets.exists("x"));
      assertEquals(java.util.List.of("x"), LocalSecrets.list());
    } finally {
      LocalSecrets.testOverride = null;
    }
  }
}
