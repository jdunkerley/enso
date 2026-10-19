package org.enso.base.enso_cloud;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import java.util.function.Supplier;
import org.enso.base.polyglot.EnsoMeta;

/**
 * The Enso-facing facade of the local secrets store. It has no way to read a value: only {@link
 * EnsoSecretReader} may, through {@link #read}.
 */
public final class LocalSecrets {
  public static final String ID_PREFIX = "local:";
  public static final String PATH_PREFIX = "secret://";

  /** The keychain key reader. PR 5 installs one; until then there is no keychain. */
  static volatile Supplier<byte[]> keychain = () -> null;

  /** Test-only: when set, {@link #current()} uses it instead of the environment. */
  static volatile Supplier<LocalSecretStore> testOverride = null;

  private LocalSecrets() {}

  public static List<String> list() throws IOException {
    return current().list();
  }

  public static boolean exists(String name) throws IOException {
    return current().exists(name);
  }

  public static void create(String name, String value) throws IOException {
    current().create(name, value);
  }

  public static void update(String name, String value) throws IOException {
    current().update(name, value);
  }

  public static void delete(String name) throws IOException {
    current().delete(name);
  }

  /** Only {@link EnsoSecretReader} may read values. */
  static String read(String name) throws IOException {
    return current().read(name);
  }

  /** Resolves the store from explicit inputs; empty overrides count as unset. */
  static LocalSecretStore open(
      String fileOverride, String keyOverride, Path home, Supplier<byte[]> keychain) {
    var file =
        fileOverride == null || fileOverride.isEmpty()
            ? home.resolve(".enso").resolve("secrets.json")
            : Path.of(fileOverride);
    byte[] key;
    if (keyOverride != null && !keyOverride.isEmpty()) {
      key = LocalSecretStore.decodeKey(keyOverride);
    } else {
      key = keychain.get();
    }
    return new LocalSecretStore(file, key, Clock.systemUTC());
  }

  private static LocalSecretStore current() {
    var override = testOverride;
    if (override != null) {
      return override.get();
    }
    return open(
        env("ENSO_SECRETS_FILE"),
        env("ENSO_SECRETS_KEY"),
        Path.of(System.getProperty("user.home")),
        keychain);
  }

  private static String env(String name) {
    var value = EnsoMeta.callStaticModuleMethod("Standard.Base.System.Environment", "get", name);
    return value.isNull() ? null : value.asString();
  }
}
