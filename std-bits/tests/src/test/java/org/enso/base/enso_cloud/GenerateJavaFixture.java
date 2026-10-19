package org.enso.base.enso_cloud;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

/**
 * Writes test/fixtures/local-secrets/java-written.json through {@link LocalSecretStore}. Run from
 * the repository root: {@code sbt "std-tests/Test/runMain
 * org.enso.base.enso_cloud.GenerateJavaFixture"}.
 */
public final class GenerateJavaFixture {
  private GenerateJavaFixture() {}

  public static void main(String[] args) throws Exception {
    var key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    var file =
        Path.of("..", "..", "test", "fixtures", "local-secrets", "java-written.json")
            .toAbsolutePath()
            .normalize();
    Files.deleteIfExists(file);
    var clock = Clock.fixed(Instant.parse("2026-10-18T14:02:11Z"), ZoneOffset.UTC);
    var store = new LocalSecretStore(file, LocalSecretStore.decodeKey(key), clock);
    store.create("alpha", "first value");
    store.create("unicode-é", "ünïcödé ✓");
    System.out.println("Wrote " + file);
  }
}
