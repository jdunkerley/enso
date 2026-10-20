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

  /** The keychain item that holds the key, as the desktop app writes it. */
  static final String KEYCHAIN_SERVICE = "Enso";

  static final String KEYCHAIN_ACCOUNT = "secrets-key";

  /**
   * The environment variable that turns the keychain lookup off: {@code ENSO_SECRETS_KEYCHAIN=off}.
   * Tests set it so that they never reach the developer's real keychain; a server can set it so
   * that only {@code ENSO_SECRETS_KEY} counts.
   */
  static final String KEYCHAIN_SWITCH_VARIABLE = "ENSO_SECRETS_KEYCHAIN";

  /** Reads the keychain; tests replace it with a fake. */
  static volatile KeychainReader keychainReader = new OsKeychain();

  /** The key from the keychain, or {@code null} when there is none to use. */
  static volatile Supplier<byte[]> keychain =
      () -> keyFromKeychain(keychainReader, KEYCHAIN_ACCOUNT);

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
    Supplier<byte[]> key;
    if (keyOverride != null && !keyOverride.isEmpty()) {
      try {
        var decoded = LocalSecretStore.decodeKey(keyOverride);
        key = () -> decoded;
      } catch (IllegalArgumentException e) {
        throw new IllegalArgumentException(
            "ENSO_SECRETS_KEY is not a valid secrets key: expected 32 bytes as unpadded"
                + " base64url.");
      }
    } else {
      // Read only when an operation needs the key, so listing never touches the keychain.
      key = keychain;
    }
    return new LocalSecretStore(file, key, Clock.systemUTC());
  }

  /**
   * As {@link #open(String, String, Path, Supplier)}, but with no keychain at all when {@code
   * keychainSwitch} (the value of {@code ENSO_SECRETS_KEYCHAIN}) is {@code off}: the keychain
   * supplier is then never called, so a key in the real keychain is never seen.
   */
  static LocalSecretStore open(
      String fileOverride,
      String keyOverride,
      String keychainSwitch,
      Path home,
      Supplier<byte[]> keychain) {
    Supplier<byte[]> source = keychainDisabled(keychainSwitch) ? () -> null : keychain;
    return open(fileOverride, keyOverride, home, source);
  }

  /** Whether {@code ENSO_SECRETS_KEYCHAIN} turns the keychain off; only {@code off} does. */
  static boolean keychainDisabled(String keychainSwitch) {
    return keychainSwitch != null && keychainSwitch.trim().equalsIgnoreCase("off");
  }

  /**
   * Reads the key stored under {@code account} for the {@code Enso} service. A missing, unreadable
   * or malformed item gives {@code null}, so the store reports it as locked.
   */
  static byte[] keyFromKeychain(KeychainReader reader, String account) {
    String text;
    try {
      text = reader.read(KEYCHAIN_SERVICE, account);
    } catch (RuntimeException | LinkageError e) {
      return null;
    }
    if (text == null || text.isBlank()) {
      return null;
    }
    try {
      return LocalSecretStore.decodeKey(text);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static LocalSecretStore current() {
    var override = testOverride;
    if (override != null) {
      return override.get();
    }
    return open(
        env("ENSO_SECRETS_FILE"),
        env("ENSO_SECRETS_KEY"),
        env(KEYCHAIN_SWITCH_VARIABLE),
        Path.of(System.getProperty("user.home")),
        keychain);
  }

  private static String env(String name) {
    var value = EnsoMeta.callStaticModuleMethod("Standard.Base.System.Environment", "get", name);
    return value.isNull() ? null : value.asString();
  }
}
