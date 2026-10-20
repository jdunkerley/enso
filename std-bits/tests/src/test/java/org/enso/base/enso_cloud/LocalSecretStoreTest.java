package org.enso.base.enso_cloud;

import static org.junit.Assert.*;

import java.nio.file.*;
import java.time.*;
import java.util.List;
import org.junit.*;
import org.junit.rules.TemporaryFolder;

public class LocalSecretStoreTest {
  static final String FIXTURE_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  // The forked test JVM runs in std-bits/tests.
  static final Path FIXTURES = Path.of("..", "..", "test", "fixtures", "local-secrets");
  @Rule public TemporaryFolder tmp = new TemporaryFolder();
  final Clock clock = Clock.fixed(Instant.parse("2026-10-18T14:02:11Z"), ZoneOffset.UTC);

  private LocalSecretStore store(Path file, String key) {
    return new LocalSecretStore(file, key == null ? null : LocalSecretStore.decodeKey(key), clock);
  }

  @Test
  public void readsTheNodeWrittenFixture() throws Exception {
    var s = store(FIXTURES.resolve("node-written.json"), FIXTURE_KEY);
    assertEquals(List.of("alpha", "unicode-é"), s.list());
    assertEquals("first value", s.read("alpha"));
    assertEquals("ünïcödé ✓", s.read("unicode-é"));
  }

  @Test
  public void readsTheJavaWrittenFixture() throws Exception {
    var s = store(FIXTURES.resolve("java-written.json"), FIXTURE_KEY);
    assertEquals(List.of("alpha", "unicode-é"), s.list());
    assertEquals("first value", s.read("alpha"));
    assertEquals("ünïcödé ✓", s.read("unicode-é"));
  }

  @Test
  public void roundTripsCreateUpdateDelete() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var s = store(file, FIXTURE_KEY);
    s.create("db-password", "s3cret");
    assertEquals("s3cret", s.read("db-password"));
    s.update("db-password", "n3w");
    assertEquals("n3w", s.read("db-password"));
    s.delete("db-password");
    assertFalse(s.exists("db-password"));
    assertFalse(Files.exists(file.resolveSibling("secrets.json.lock")));
  }

  @Test
  public void listingNeedsNoKeyButReadingDoes() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var locked = store(file, null);
    assertEquals(List.of("a"), locked.list());
    var e = assertThrows(LocalSecretException.class, () -> locked.read("a"));
    assertEquals(LocalSecretException.Kind.LOCKED, e.kind());
  }

  @Test
  public void aDifferentKeyIsWrongKey() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var other = LocalSecretStore.encodeKey(new byte[32]);
    var e = assertThrows(LocalSecretException.class, () -> store(file, other).read("a"));
    assertEquals(LocalSecretException.Kind.WRONG_KEY, e.kind());
  }

  @Test
  public void aValueMovedToAnotherNameFailsToDecrypt() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var s = store(file, FIXTURE_KEY);
    s.create("a", "1");
    s.create("b", "2");
    var json = Files.readString(file);
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
    var root = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(json);
    var secrets = (com.fasterxml.jackson.databind.node.ObjectNode) root.get("secrets");
    secrets.set("b", secrets.get("a").deepCopy());
    Files.writeString(file, mapper.writeValueAsString(root));
    var e = assertThrows(LocalSecretException.class, () -> s.read("b"));
    assertEquals(LocalSecretException.Kind.WRONG_KEY, e.kind());
  }

  @Test
  public void aMalformedEntryIsWrongKeyLikeInNode() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var s = store(file, FIXTURE_KEY);
    s.create("a", "1");
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
    var root = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(file.toFile());
    var entry = (com.fasterxml.jackson.databind.node.ObjectNode) root.get("secrets").get("a");
    entry.put("nonce", "not base64!");
    Files.writeString(file, mapper.writeValueAsString(root));
    var e = assertThrows(LocalSecretException.class, () -> s.read("a"));
    assertEquals(LocalSecretException.Kind.WRONG_KEY, e.kind());
  }

  @Test
  public void missingAndDuplicateNames() throws Exception {
    var s = store(tmp.getRoot().toPath().resolve("secrets.json"), FIXTURE_KEY);
    var missing = assertThrows(LocalSecretException.class, () -> s.read("nope"));
    assertEquals(LocalSecretException.Kind.NOT_FOUND, missing.kind());
    assertEquals("nope", missing.secretName());
    s.create("a", "1");
    assertEquals(
        LocalSecretException.Kind.ALREADY_EXISTS,
        assertThrows(LocalSecretException.class, () -> s.create("a", "2")).kind());
  }

  @Test
  public void aNewerVersionIsRefused() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    Files.writeString(file, "{\"version\": 2, \"secrets\": {}}");
    assertEquals(
        LocalSecretException.Kind.NEWER_VERSION,
        assertThrows(LocalSecretException.class, () -> store(file, FIXTURE_KEY).list()).kind());
  }

  @Test
  public void unknownFieldsArePreserved() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var s = store(file, FIXTURE_KEY);
    s.create("a", "1");
    var text = Files.readString(file).replaceFirst("\\{", "{\"futureField\": 42,");
    Files.writeString(file, text);
    s.create("b", "2");
    assertTrue(Files.readString(file).contains("\"futureField\""));
  }

  @Test
  public void aStaleLockIsTakenOver() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var lock = file.resolveSibling("secrets.json.lock");
    Files.writeString(lock, "");
    Files.setLastModifiedTime(
        lock, java.nio.file.attribute.FileTime.from(Instant.now().minusSeconds(60)));
    store(file, FIXTURE_KEY).create("a", "1");
    assertFalse(Files.exists(lock));
  }

  @Test
  public void theFirstWriteRecordsTheKey() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(Files.readString(file));
    assertEquals(1, root.get("version").asInt());
    assertEquals(
        LocalSecretStore.keyId(LocalSecretStore.decodeKey(FIXTURE_KEY)),
        root.get("keyId").asText());
    assertEquals("2026-10-18T14:02:11Z", root.get("keyCreated").asText());
  }

  @Test
  public void anEmptyFileUnderAnotherKeyAdoptsTheCurrentKey() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    Files.writeString(
        file,
        "{\"version\": 1, \"keyId\": \"0123456789abcdef\", \"keyCreated\":"
            + " \"2020-01-01T00:00:00Z\", \"futureField\": 42, \"secrets\": {}}");
    var s = store(file, FIXTURE_KEY);
    s.create("a", "1");
    assertEquals("1", s.read("a"));
    var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(Files.readString(file));
    assertEquals(
        LocalSecretStore.keyId(LocalSecretStore.decodeKey(FIXTURE_KEY)),
        root.get("keyId").asText());
    assertEquals("2026-10-18T14:02:11Z", root.get("keyCreated").asText());
    assertEquals(42, root.get("futureField").asInt());
  }

  @Test
  public void aFileWithSecretsUnderAnotherKeyRefusesWrites() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var before = Files.readString(file);
    var other = store(file, LocalSecretStore.encodeKey(new byte[32]));
    assertEquals(
        LocalSecretException.Kind.WRONG_KEY,
        assertThrows(LocalSecretException.class, () -> other.create("b", "2")).kind());
    assertEquals(before, Files.readString(file));
  }

  @Test
  public void objectPrototypeNamesAreOrdinaryNames() throws Exception {
    // The Node store must special-case these; pin that Java agrees.
    var s = store(tmp.getRoot().toPath().resolve("secrets.json"), FIXTURE_KEY);
    for (var name : List.of("__proto__", "constructor", "prototype")) {
      s.create(name, "v-" + name);
    }
    assertEquals(List.of("__proto__", "constructor", "prototype"), s.list());
    assertEquals("v-__proto__", s.read("__proto__"));
  }
}
