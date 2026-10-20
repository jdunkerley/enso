package org.enso.base.enso_cloud;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class LocalSecretsKeychainTest {
  static final String FIXTURE_KEY = LocalSecretStoreTest.FIXTURE_KEY;

  @Rule public TemporaryFolder tmp = new TemporaryFolder();

  private final KeychainReader original = LocalSecrets.keychainReader;

  @After
  public void restoreReader() {
    LocalSecrets.keychainReader = original;
  }

  @Test
  public void theKeychainSupplierReadsTheConventionItem() {
    var asked = new ArrayList<List<String>>();
    LocalSecrets.keychainReader =
        (service, account) -> {
          asked.add(List.of(service, account));
          return "Enso".equals(service) && "secrets-key".equals(account) ? FIXTURE_KEY : null;
        };
    assertArrayEquals(LocalSecretStore.decodeKey(FIXTURE_KEY), LocalSecrets.keychain.get());
    assertEquals(List.of(List.of("Enso", "secrets-key")), asked);
  }

  @Test
  public void surroundingWhitespaceInTheItemIsIgnored() {
    LocalSecrets.keychainReader = (service, account) -> FIXTURE_KEY + "\n";
    assertArrayEquals(LocalSecretStore.decodeKey(FIXTURE_KEY), LocalSecrets.keychain.get());
  }

  @Test
  public void aMissingItemIsNoKey() {
    LocalSecrets.keychainReader = (service, account) -> null;
    assertNull(LocalSecrets.keychain.get());
  }

  @Test
  public void anEmptyOrMalformedItemIsNoKey() {
    LocalSecrets.keychainReader = (service, account) -> "";
    assertNull(LocalSecrets.keychain.get());
    LocalSecrets.keychainReader = (service, account) -> "not-a-key!!";
    assertNull(LocalSecrets.keychain.get());
  }

  @Test
  public void aFailingReaderIsNoKey() {
    LocalSecrets.keychainReader =
        (service, account) -> {
          throw new IllegalStateException("no keyring daemon");
        };
    assertNull(LocalSecrets.keychain.get());
    LocalSecrets.keychainReader =
        (service, account) -> {
          throw new UnsatisfiedLinkError("libsecret-1.so.0: cannot open shared object file");
        };
    assertNull(LocalSecrets.keychain.get());
  }

  @Test
  public void withAKeychainKeyTheStoreIsUnlocked() throws Exception {
    LocalSecrets.keychainReader = (service, account) -> FIXTURE_KEY;
    var s = LocalSecrets.open(null, null, tmp.getRoot().toPath(), LocalSecrets.keychain);
    s.create("a", "1");
    assertEquals("1", s.read("a"));
  }

  @Test
  public void theWindowsTargetIsAccountDotService() {
    assertEquals("secrets-key.Enso", OsKeychain.windowsTarget("Enso", "secrets-key"));
  }

  @Test
  public void theOsReaderNeverThrows() {
    // Outside an Enso context, and without JNA on the test classpath, the real reader cannot reach
    // any keychain: it must say "no item" rather than fail. The account does not exist anyway.
    assertNull(new OsKeychain().read("Enso", "no-such-account-for-tests"));
  }
}
