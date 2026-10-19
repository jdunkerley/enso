package org.enso.base.enso_cloud;

import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.core.util.Separators;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The local secrets file: an encrypted {@code secrets.json} shared with the app's Node store.
 *
 * <p>Format: {@code {"version": 1, "keyId", "keyCreated", "secrets": {name: {"nonce", "value",
 * "created", "updated"}}}}. Each value is AES-256-GCM encrypted with a fresh 12-byte nonce, and the
 * secret name as the additional authenticated data. Decrypted values are only ever returned to the
 * package, never to Enso.
 */
final class LocalSecretStore {
  static final int VERSION = 1;

  private static final long STALE_LOCK_MILLIS = 30_000;
  private static final long LOCK_RETRY_MILLIS = 50;
  private static final long LOCK_TIMEOUT_MILLIS = 10_000;
  private static final int KEY_BYTES = 32;
  private static final int NONCE_BYTES = 12;
  private static final int TAG_BITS = 128;

  private static final ObjectMapper MAPPER = new ObjectMapper();
  // Two-space indent, LF line endings and `"key": value`, as Node and prettier write JSON.
  private static final DefaultPrettyPrinter PRINTER =
      new DefaultPrettyPrinter()
          .withSeparators(
              Separators.createDefaultInstance()
                  .withObjectFieldValueSpacing(Separators.Spacing.AFTER))
          .withObjectIndenter(new DefaultIndenter("  ", "\n"))
          .withArrayIndenter(new DefaultIndenter("  ", "\n"));
  private static final SecureRandom RANDOM = new SecureRandom();

  private final Path file;
  private final byte[] key;
  private final Clock clock;

  LocalSecretStore(Path file, byte[] keyOrNull, Clock clock) {
    this.file = file;
    this.key = keyOrNull;
    this.clock = clock;
  }

  List<String> list() throws IOException {
    var root = readRoot();
    var names = new ArrayList<String>();
    if (root != null) {
      secretsOf(root).fieldNames().forEachRemaining(names::add);
    }
    names.sort(null);
    return names;
  }

  boolean exists(String name) throws IOException {
    var root = readRoot();
    return root != null && secretsOf(root).has(name);
  }

  String read(String name) throws IOException {
    if (key == null) {
      throw LocalSecretException.locked();
    }
    var root = readRoot();
    var entry = root == null ? null : secretsOf(root).get(name);
    if (entry == null) {
      throw notFound(name);
    }
    if (!keyId(key).equals(root.path("keyId").asText())) {
      throw LocalSecretException.wrongKey();
    }
    return decrypt(name, entry.path("nonce").asText(), entry.path("value").asText());
  }

  void create(String name, String value) throws IOException {
    write(
        (root, now) -> {
          var secrets = secretsOf(root);
          if (secrets.has(name)) {
            throw new LocalSecretException(
                LocalSecretException.Kind.ALREADY_EXISTS,
                "A local secret named '" + name + "' already exists.");
          }
          var entry = encrypt(name, value);
          entry.put("created", now);
          entry.put("updated", now);
          secrets.set(name, entry);
        });
  }

  void update(String name, String value) throws IOException {
    write(
        (root, now) -> {
          var secrets = secretsOf(root);
          if (!(secrets.get(name) instanceof ObjectNode old)) {
            throw notFound(name);
          }
          var entry = encrypt(name, value);
          entry.put("created", old.path("created").asText(now));
          entry.put("updated", now);
          secrets.set(name, entry);
        });
  }

  void delete(String name) throws IOException {
    write(
        (root, now) -> {
          if (secretsOf(root).remove(name) == null) {
            throw notFound(name);
          }
        });
  }

  static byte[] decodeKey(String base64url) {
    byte[] bytes;
    try {
      bytes = Base64.getUrlDecoder().decode(base64url.trim());
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("The secrets key is not valid base64url.");
    }
    if (bytes.length != KEY_BYTES) {
      throw new IllegalArgumentException("The secrets key must be 32 bytes.");
    }
    return bytes;
  }

  static String encodeKey(byte[] key) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(key);
  }

  static String keyId(byte[] key) {
    try {
      var digest = MessageDigest.getInstance("SHA-256").digest(key);
      return HexFormat.of().formatHex(digest, 0, 8);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private interface Mutation {
    void apply(ObjectNode root, String now);
  }

  private void write(Mutation mutation) throws IOException {
    if (key == null) {
      throw LocalSecretException.locked();
    }
    var parent = file.toAbsolutePath().getParent();
    if (parent != null) {
      Files.createDirectories(parent);
    }
    withLock(
        () -> {
          var now =
              DateTimeFormatter.ISO_INSTANT.format(clock.instant().truncatedTo(ChronoUnit.SECONDS));
          var root = readRoot();
          if (root == null) {
            root = JsonNodeFactory.instance.objectNode();
            root.put("version", VERSION);
            root.put("keyId", keyId(key));
            root.put("keyCreated", now);
            root.set("secrets", JsonNodeFactory.instance.objectNode());
          } else if (!keyId(key).equals(root.path("keyId").asText())) {
            throw LocalSecretException.wrongKey();
          }
          mutation.apply(root, now);
          var tmp = file.resolveSibling(file.getFileName() + ".tmp");
          try {
            Files.write(
                tmp,
                (MAPPER.writer(PRINTER).writeValueAsString(root) + "\n")
                    .getBytes(StandardCharsets.UTF_8));
            try {
              Files.move(
                  tmp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
              Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
            }
          } finally {
            Files.deleteIfExists(tmp);
          }
        });
  }

  private interface IoAction {
    void run() throws IOException;
  }

  private void withLock(IoAction action) throws IOException {
    var lock = file.resolveSibling(file.getFileName() + ".lock");
    var deadline = System.nanoTime() + Duration.ofMillis(LOCK_TIMEOUT_MILLIS).toNanos();
    while (true) {
      try {
        Files.createFile(lock);
        break;
      } catch (FileAlreadyExistsException e) {
        try {
          var age = Instant.now().toEpochMilli() - Files.getLastModifiedTime(lock).toMillis();
          if (age > STALE_LOCK_MILLIS) {
            Files.deleteIfExists(lock);
            continue;
          }
        } catch (NoSuchFileException gone) {
          continue;
        }
        if (System.nanoTime() > deadline) {
          throw new IOException("Timed out waiting for " + lock);
        }
        try {
          Thread.sleep(LOCK_RETRY_MILLIS);
        } catch (InterruptedException ie) {
          Thread.currentThread().interrupt();
          throw new IOException("Interrupted waiting for " + lock, ie);
        }
      }
    }
    try {
      action.run();
    } finally {
      Files.deleteIfExists(lock);
    }
  }

  /** Reads the file, or returns null when it does not exist. Refuses a newer version. */
  private ObjectNode readRoot() throws IOException {
    byte[] bytes;
    try {
      bytes = Files.readAllBytes(file);
    } catch (NoSuchFileException e) {
      return null;
    }
    if (!(MAPPER.readTree(bytes) instanceof ObjectNode root)) {
      throw new IOException("The local secrets file is not a JSON object.");
    }
    if (root.path("version").asInt(VERSION) > VERSION) {
      throw new LocalSecretException(
          LocalSecretException.Kind.NEWER_VERSION,
          "The local secrets file was written by a newer version of Enso.");
    }
    return root;
  }

  private static ObjectNode secretsOf(ObjectNode root) {
    if (root.get("secrets") instanceof ObjectNode secrets) {
      return secrets;
    }
    return root.putObject("secrets");
  }

  private static LocalSecretException notFound(String name) {
    return new LocalSecretException(
        LocalSecretException.Kind.NOT_FOUND, "No local secret named '" + name + "'.");
  }

  private ObjectNode encrypt(String name, String value) {
    try {
      var nonce = new byte[NONCE_BYTES];
      RANDOM.nextBytes(nonce);
      var cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.ENCRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(TAG_BITS, nonce));
      cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
      var body = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      var entry = JsonNodeFactory.instance.objectNode();
      entry.put("nonce", Base64.getEncoder().encodeToString(nonce));
      entry.put("value", Base64.getEncoder().encodeToString(body));
      return entry;
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Could not encrypt the secret.", e);
    }
  }

  private String decrypt(String name, String nonce, String value) {
    try {
      var cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(TAG_BITS, Base64.getDecoder().decode(nonce)));
      cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
      var plain = cipher.doFinal(Base64.getDecoder().decode(value));
      return new String(plain, StandardCharsets.UTF_8);
    } catch (AEADBadTagException e) {
      throw LocalSecretException.wrongKey();
    } catch (GeneralSecurityException | IllegalArgumentException e) {
      throw new IllegalStateException("Could not decrypt the secret.", e);
    }
  }
}
