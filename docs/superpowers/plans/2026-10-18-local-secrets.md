# Local Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local, encrypted, per-user secrets that Enso code, datalinks and the
command line can use without Enso Cloud, managed from the IDE's Settings, with
key rotation and age reminders.

**Architecture:**

- **One file, one key.** One file, `~/.enso/secrets.json`, holds
  AES-256-GCM-encrypted values under one master key.
- **Two implementations of the store:** Java in `std-bits/base`, which the
  engine uses to resolve `Enso_Secret` / `secret://`, and Node in the
  project-manager shim, which the in-process Electron main uses for the Settings
  UI. Shared fixture files prove the two read each other's output.
- **The key** comes from `ENSO_SECRETS_KEY` or the OS keychain. Electron main
  owns the keychain item and passes the key to the engines it starts.

**Tech Stack:**

- **Engine:** Enso (`Standard.Base`) and Java 25 (`javax.crypto`, Jackson) in
  `std-bits/base`, with JUnit tests in `std-bits/tests`.
- **App:** TypeScript, with Node `crypto` in `app/project-manager-shim`,
  Electron main with `@napi-rs/keyring`, and Vue 3 in the GUI. Tests use vitest
  and Playwright.
- **Desktop command line:** java-keyring through a `lib/java` wrapper (PR 5, if
  the spike passes).

**Spec:** `docs/superpowers/specs/2026-10-18-local-secrets-design.md` (PR #253).
Read it before starting any task.

## Global Constraints

- **File:** `~/.enso/secrets.json`. `ENSO_SECRETS_FILE` overrides it, in both
  Java and Node.
- **File format:**
  `{"version": 1, "keyId", "keyCreated", "secrets": {<name>: {"nonce", "value", "created", "updated"}}}`:
  - Timestamps are ISO-8601 UTC with seconds (`2026-10-18T14:02:11Z`).
  - Unknown fields are preserved.
  - A file with `version` > 1 is refused.
- **Crypto:**
  - AES-256-GCM, a fresh 12-byte random nonce per value, and a 128-bit tag.
  - **AAD = the secret name in UTF-8.**
  - `nonce` and `value` are standard base64 with padding. `value` is the
    ciphertext followed by the 16-byte tag.
  - `keyId` is the lowercase hex of the first 8 bytes of SHA-256(key).
- **Key:** 32 bytes, written as **unpadded base64url**.
  - Sources, in order: `ENSO_SECRETS_KEY`, then the keychain item service
    `Enso`, account `secrets-key`.
  - The pending rotation item is account `secrets-key-next`.
- **Lock:** `<file>.lock`, created exclusively (`CREATE_NEW` / `wx`).
  - A lock older than 30 000 ms is stale: delete it and retry.
  - Waiting retries every 50 ms for up to 10 s, then fails.
  - Writes go to `<file>.tmp` and are renamed over the file.
- **Names:** non-empty, no `/`, not starting with `connection-` (the stdlib's
  existing rules), and not starting with `secret://`. Maximum 200 characters.
- **Path form:** `secret://<name>`. In Enso, a bare name and `secret://` are
  local; `enso://` keeps the cloud code. The Java id of a local secret is
  `local:<name>`.
- **Values never reach Enso.** The Java class that decrypts is **package-private
  in `org.enso.base.enso_cloud`**, next to `EnsoSecretReader`. Enso sees only a
  public facade with no read method. No shim endpoint or IPC call returns a
  secret value. Only the IPC call `secrets.copyKey` returns the master key.
- **Error kinds,** shared by both sides: `NOT_FOUND`, `LOCKED`, `WRONG_KEY`,
  `ALREADY_EXISTS`, `NEWER_VERSION`. The messages:
  - LOCKED:
    `Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop where they were created.`
  - WRONG_KEY: `The local secrets file was created with a different key.`
- **Rotation reminders:** after 365 days since `keyCreated`, then every 30 days
  after a snooze. None when the key comes from `ENSO_SECRETS_KEY`.
- **Pins:** `@napi-rs/keyring` is pinned exactly, and so is java-keyring (PR 5).
  Note the reason next to each pin.
- **Repo rules** (root `CLAUDE.md`):
  - Use `corepack pnpm`.
  - Verify on Linux (WSL) too.
  - A new Java class used from Enso through `polyglot java import` needs an
    entry in
    `std-bits/base/src/main/resources/META-INF/native-image/org/enso/base/reflect-config.json`.
  - Run `sbt "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck"` after
    touching Java or Scala.
  - Changelog entries go on PR 1 (Standard Library) and PR 2 (IDE). PRs 3–5 are
    features too, but are described under PR 2's entry, so they take the
    `CI: No changelog needed` label unless the user asks otherwise.
- **Merge gate:** features wait for the user's test (memory
  `merge-gate-features`).
- **Never use `git stash`.**

## Plan-level decisions (beyond the spec)

- **Engine shape.** `Enso_Secret` gains a second private constructor, `Local`,
  with the **same four field names** as `Value`
  (`internal_name id internal_path credential_metadata`). That keeps every
  existing field accessor working: for `Local`, `id = "local:"+name`,
  `internal_path = "secret://"+name` (a `Text`), and
  `credential_metadata = Nothing`. Behaviour branches with
  `case self of Enso_Secret.Local … ->`.
- **When the key is created.** Electron main creates the keychain key at app
  start when there is no `ENSO_SECRETS_KEY`, no keychain item, and **no secrets
  file with secrets in it**. That way engines started before the first secret is
  saved already have the key. If a file with secrets exists but no key does, the
  status is `missing` and nothing is created.
- **Deleting a secret from the app** uses a new
  `LocalBackend.deleteLocalSecret(name)`. The abstract `Backend` has no secret
  delete, because cloud secrets are deleted as assets.

## Branches and worktrees

Base everything on `origin/develop`.

| PR  | Branch                                         | Worktree                 |
| --- | ---------------------------------------------- | ------------------------ |
| 1   | `feature/local-secrets-engine`                 | `C:\Repos\Enso\ide-sec1` |
| 2   | `feature/local-secrets-app` (on PR 1)          | `C:\Repos\Enso\ide-sec2` |
| 3   | `feature/local-secrets-editors` (on PR 2)      | `C:\Repos\Enso\ide-sec3` |
| 4   | `feature/local-secrets-rotation` (on PR 3)     | `C:\Repos\Enso\ide-sec4` |
| 5   | `feature/local-secrets-cli-keychain` (on PR 1) | `C:\Repos\Enso\ide-sec5` |

In each new worktree, run `corepack pnpm install --frozen-lockfile`. Retarget a
child PR to `develop` before merging its parent (memory
`stacked-pr-merge-order`).

## File map

**PR 1: the engine store**

- Create `test/fixtures/local-secrets/`:
  - `README.md`, giving the test key and how to regenerate
  - `node-written.json` and `generate-node.mjs`
  - `java-written.json`, with its generator in the JUnit test sources
    (`GenerateJavaFixture.java`)
- Create in `std-bits/base/src/main/java/org/enso/base/enso_cloud/`:
  - `LocalSecretStore.java`: package-private format, crypto, lock and file I/O
  - `LocalSecretException.java`: public, with a `Kind` enum
  - `LocalSecrets.java`: public facade for Enso, plus package-private `read` and
    resolution from the environment
- Modify `EnsoSecretReader.java`, adding the `local:` branch.
- Modify
  `std-bits/base/src/main/resources/META-INF/native-image/org/enso/base/reflect-config.json`.
- Create
  `std-bits/tests/src/test/java/org/enso/base/enso_cloud/LocalSecretStoreTest.java`
  and `GenerateJavaFixture.java`.
- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Enso_Secret.enso` and
  `Data_Link_Helpers.enso`.
- Create `test/Base_Tests/src/Network/Local_Secrets_Spec.enso`, and modify
  `test/Base_Tests/src/Main.enso`.
- Create `docs/local-secrets.md`. Modify `CHANGELOG.md`.

**PR 2: the app's store and Settings**

- Create `app/project-manager-shim/src/localSecrets/`: `index.ts`, `crypto.ts`
  and `__tests__/`.
- Modify `app/project-manager-shim/package.json` (exports),
  `src/handler/projectService.ts` (`SECRET_ROUTES`) and
  `src/projectService/index.ts` (extra engine environment).
- Modify `app/common/src/services/ProjectManager/ProjectManager.ts` and
  `LocalBackend.ts`.
- Create `app/electron-client/src/secretsKey.ts` and
  `tests/headless/secretsKey.test.ts`.
- Modify `app/electron-client/src/projectService.ts`, `server.ts`, `index.ts`,
  `ipc.ts`, `preload.ts`, `electron.ts` and `package.json`, plus
  `app/gui/src/electronApi.ts`.
- Create `app/gui/src/dashboard/layouts/Settings/SecretsSettingsSection.vue` and
  modify `tabs.ts` and `app/common/src/text/english.json`.
- Modify `CHANGELOG.md`.

**PR 3: secrets in the editors**

- Modify `app/gui/src/datalinks/DatalinkInput.vue` and `JSONSchemaInput.vue`,
  and create `app/gui/src/datalinks/SecretPicker.vue`.
- Create `app/gui/src/providers/localSecrets.ts` (a query composable).
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/localSecrets.ts`,
  and modify `WidgetFileBrowser.vue` and `localBrowser.ts`.
- Modify `app/gui/src/secrets/CLAUDE.md`.

**PR 4: rotation and reminders**

- Modify the shim's `localSecrets/index.ts` (`rotate`) and Electron's
  `secretsKey.ts` (rotation and recovery).
- Modify the IPC files and `SecretsSettingsSection.vue`.
- Create `app/gui/src/composables/secretsKeyReminder.ts` and
  `app/gui/src/secrets/SecretsKeyReminderToast.vue`, and modify
  `app/gui/src/App.vue`.

**PR 5: the desktop command-line keychain**

- Create `lib/java/keyring-wrapper/`, and modify `build.sbt`,
  `project/Dependencies.scala`, `LocalSecrets.java` and the native-image
  configuration.

---

## Phase 0: Spike (throwaway)

### Task 1: Check that the keychain item can be shared, and works in the native image

**Files:** none committed. Scratch goes under `<scratchpad>/secrets-spike/`, on
the branch `spike/keyring` (deleted afterwards).

- [ ] **Step 1: Write the item from Node**

```bash
mkdir -p <scratchpad>/secrets-spike/node && cd <scratchpad>/secrets-spike/node
npm init -y && npm i @napi-rs/keyring
node -e "const {Entry}=require('@napi-rs/keyring'); new Entry('Enso','spike-key').setPassword('hello-from-node'); console.log(new Entry('Enso','spike-key').getPassword())"
```

Expected: `hello-from-node`. Then record how it appears:

- on Windows, `cmdkey /list | findstr -i enso`: the target name
- on Linux (WSL with `gnome-keyring-daemon` unlocked, or `dbus-run-session`),
  `secret-tool search service Enso`

- [ ] **Step 2: Read it from Java (JVM)**

Use a single-file Java program with java-keyring on the classpath. Take the
latest `com.github.javakeyring:java-keyring` from Maven Central, and JNA 5.14.0
to match `project/Dependencies.scala`:

```java
import com.github.javakeyring.Keyring;
public class Spike { public static void main(String[] a) throws Exception {
  try (var k = Keyring.create()) { System.out.println(k.getPassword("Enso", "spike-key")); } } }
```

Expected: `hello-from-node` on Windows and Linux.

**If java-keyring does not see Node's item** (different target-name
conventions), try in order:

1. Make Node use java-keyring's convention. `@napi-rs/keyring` may accept a
   target, as in `Entry.withTarget(...)`.
2. Otherwise read the item from Java with JNA directly: `CredReadW` on Windows,
   `secret_password_lookup_sync` on Linux.

Record which works.

- [ ] **Step 3: Read it from the native-image launcher**

1. Add a temporary class `org.enso.base.enso_cloud.KeyringSpike` to
   `std-bits/base` with
   `public static String read(String service, String account)`, using the
   approach from Step 2.
2. Add its reflect-config entry, and add `jna-wrapper` the way `std-microsoft`
   does (`build.sbt` around 6030–6099, as a `provided` dependency, copying
   `jna-wrapper-extracted`).
3. Build the native launcher with the memory `local-windows-installer-build`
   recipe (`ENSO_LAUNCHER=native`), or the faster `sbt buildEngineDistribution`
   with native image enabled.
4. Run an Enso file:

```
polyglot java import org.enso.base.enso_cloud.KeyringSpike
main = IO.println (KeyringSpike.read "Enso" "spike-key")
```

Expected: `hello-from-node`. Do this on Windows, and on Linux in WSL.

- [ ] **Step 4: macOS (optional, through CI)**

**Ask the user before pushing.** If they agree:

1. Push `spike/keyring` with a temporary workflow that, on `macos-latest`,
   writes the item with Node and reads it with the JVM program from Step 2. Use
   the JVM, not the native launcher, to keep it cheap.
2. Record whether a keychain prompt blocks a headless run.
3. Delete the branch afterwards.

- [ ] **Step 5: Report and decide**

Write the results into the ledger.

- **PR 5 goes ahead** only if Step 3 works on Windows and Linux.
- **Otherwise PR 5 is dropped:** desktop command-line use then needs
  `ENSO_SECRETS_KEY`, and Task 15 instead documents that.

Carry into Task 8 the keychain identity convention that both sides can use.
Clean up: delete the spike items (`cmdkey /delete:<target>` /
`secret-tool clear service Enso`), the branch and the scratch folder.

---

## PR 1: the engine store

### Task 2: Cross-language fixtures and the Java store

**Files:**

- Create: `test/fixtures/local-secrets/README.md`, `generate-node.mjs`,
  `node-written.json` and `java-written.json`
- Create:
  `std-bits/base/src/main/java/org/enso/base/enso_cloud/LocalSecretStore.java`
  and `LocalSecretException.java`
- Create:
  `std-bits/tests/src/test/java/org/enso/base/enso_cloud/LocalSecretStoreTest.java`
  and `GenerateJavaFixture.java`

**Interfaces:**

- Produces (package-private, `org.enso.base.enso_cloud`):

```java
final class LocalSecretStore {
  static final int VERSION = 1;
  LocalSecretStore(Path file, byte[] keyOrNull, Clock clock);
  List<String> list() throws IOException;            // sorted names; no key needed
  boolean exists(String name) throws IOException;
  String read(String name) throws IOException;       // LOCKED / WRONG_KEY / NOT_FOUND
  void create(String name, String value) throws IOException;  // ALREADY_EXISTS; creates the file
  void update(String name, String value) throws IOException;  // NOT_FOUND
  void delete(String name) throws IOException;       // NOT_FOUND
  static byte[] decodeKey(String base64url);          // IllegalArgumentException unless 32 bytes
  static String encodeKey(byte[] key);
  static String keyId(byte[] key);
}
```

- Produces (public): `LocalSecretException extends RuntimeException`, with
  `enum Kind { NOT_FOUND, LOCKED, WRONG_KEY, ALREADY_EXISTS, NEWER_VERSION }`
  and `Kind kind()`.
- Fixture key (test-only, documented in the README):
  `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` (bytes 0..31).
- Fixture secrets: `alpha` = `first value`, and `unicode-é` = `ünïcödé ✓`.

- [ ] **Step 1: Write the Node fixture generator and generate**

`test/fixtures/local-secrets/generate-node.mjs`:

```js
// Writes node-written.json: the local secrets format (docs/superpowers/specs/2026-10-18-local-secrets-design.md)
// as the app's Node store writes it, for the Java tests to read. Run: node generate-node.mjs
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const key = Buffer.from(
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "base64url",
);
const keyId = createHash("sha256")
  .update(key)
  .digest()
  .subarray(0, 8)
  .toString("hex");
const stamp = "2026-10-18T14:02:11Z";
function encrypt(name, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const body = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    nonce: nonce.toString("base64"),
    value: body.toString("base64"),
    created: stamp,
    updated: stamp,
  };
}
const file = {
  version: 1,
  keyId,
  keyCreated: stamp,
  secrets: {
    alpha: encrypt("alpha", "first value"),
    "unicode-é": encrypt("unicode-é", "ünïcödé ✓"),
  },
};
writeFileSync(
  new URL("./node-written.json", import.meta.url),
  JSON.stringify(file, null, 2) + "\n",
);
```

Run it: `node test/fixtures/local-secrets/generate-node.mjs`. Write the README
with the key, the two secrets, and "regenerate only when the format version
changes".

- [ ] **Step 2: Write the failing Java tests**

`std-bits/tests/src/test/java/org/enso/base/enso_cloud/LocalSecretStoreTest.java`:

```java
package org.enso.base.enso_cloud;

import static org.junit.Assert.*;

import java.nio.file.*;
import java.time.*;
import java.util.List;
import org.junit.*;
import org.junit.rules.TemporaryFolder;

public class LocalSecretStoreTest {
  static final String FIXTURE_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  static final Path FIXTURES = Path.of("..", "..", "test", "fixtures", "local-secrets");
  @Rule public TemporaryFolder tmp = new TemporaryFolder();
  final Clock clock = Clock.fixed(Instant.parse("2026-10-18T14:02:11Z"), ZoneOffset.UTC);

  private LocalSecretStore store(Path file, String key) {
    return new LocalSecretStore(file, key == null ? null : LocalSecretStore.decodeKey(key), clock);
  }

  @Test public void readsTheNodeWrittenFixture() throws Exception {
    var s = store(FIXTURES.resolve("node-written.json"), FIXTURE_KEY);
    assertEquals(List.of("alpha", "unicode-é"), s.list());
    assertEquals("first value", s.read("alpha"));
    assertEquals("ünïcödé ✓", s.read("unicode-é"));
  }

  @Test public void roundTripsCreateUpdateDelete() throws Exception {
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

  @Test public void listingNeedsNoKeyButReadingDoes() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var locked = store(file, null);
    assertEquals(List.of("a"), locked.list());
    var e = assertThrows(LocalSecretException.class, () -> locked.read("a"));
    assertEquals(LocalSecretException.Kind.LOCKED, e.kind());
  }

  @Test public void aDifferentKeyIsWrongKey() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var other = LocalSecretStore.encodeKey(new byte[32]);
    var e = assertThrows(LocalSecretException.class, () -> store(file, other).read("a"));
    assertEquals(LocalSecretException.Kind.WRONG_KEY, e.kind());
  }

  @Test public void aValueMovedToAnotherNameFailsToDecrypt() throws Exception {
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

  @Test public void missingAndDuplicateNames() throws Exception {
    var s = store(tmp.getRoot().toPath().resolve("secrets.json"), FIXTURE_KEY);
    assertEquals(LocalSecretException.Kind.NOT_FOUND,
        assertThrows(LocalSecretException.class, () -> s.read("nope")).kind());
    s.create("a", "1");
    assertEquals(LocalSecretException.Kind.ALREADY_EXISTS,
        assertThrows(LocalSecretException.class, () -> s.create("a", "2")).kind());
  }

  @Test public void aNewerVersionIsRefused() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    Files.writeString(file, "{\"version\": 2, \"secrets\": {}}");
    assertEquals(LocalSecretException.Kind.NEWER_VERSION,
        assertThrows(LocalSecretException.class, () -> store(file, FIXTURE_KEY).list()).kind());
  }

  @Test public void unknownFieldsArePreserved() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var s = store(file, FIXTURE_KEY);
    s.create("a", "1");
    var text = Files.readString(file).replaceFirst("\\{", "{\"futureField\": 42,");
    Files.writeString(file, text);
    s.create("b", "2");
    assertTrue(Files.readString(file).contains("\"futureField\""));
  }

  @Test public void aStaleLockIsTakenOver() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    var lock = file.resolveSibling("secrets.json.lock");
    Files.writeString(lock, "");
    Files.setLastModifiedTime(lock, java.nio.file.attribute.FileTime.from(Instant.now().minusSeconds(60)));
    store(file, FIXTURE_KEY).create("a", "1");
    assertFalse(Files.exists(lock));
  }

  @Test public void theFirstWriteRecordsTheKey() throws Exception {
    var file = tmp.getRoot().toPath().resolve("secrets.json");
    store(file, FIXTURE_KEY).create("a", "1");
    var root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(Files.readString(file));
    assertEquals(1, root.get("version").asInt());
    assertEquals(LocalSecretStore.keyId(LocalSecretStore.decodeKey(FIXTURE_KEY)), root.get("keyId").asText());
    assertEquals("2026-10-18T14:02:11Z", root.get("keyCreated").asText());
  }
}
```

`GenerateJavaFixture.java`, in the same package, is a `main` that writes
`test/fixtures/local-secrets/java-written.json` with the same key and the two
fixture secrets. It does that through `LocalSecretStore` with a fixed `Clock`.

Run: `sbt "std-tests/testOnly org.enso.base.enso_cloud.LocalSecretStoreTest"`.
Expected: compilation FAILS (no `LocalSecretStore`).

- [ ] **Step 3: Implement**

`LocalSecretException.java` (public):

```java
package org.enso.base.enso_cloud;

/** A failure of the local secrets store; {@link #kind()} says which. Never carries a secret value. */
public final class LocalSecretException extends RuntimeException {
  public enum Kind { NOT_FOUND, LOCKED, WRONG_KEY, ALREADY_EXISTS, NEWER_VERSION }

  private final Kind kind;

  public LocalSecretException(Kind kind, String message) {
    super(message);
    this.kind = kind;
  }

  public Kind kind() {
    return kind;
  }

  static LocalSecretException locked() {
    return new LocalSecretException(Kind.LOCKED,
        "Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop where they were created.");
  }

  static LocalSecretException wrongKey() {
    return new LocalSecretException(Kind.WRONG_KEY, "The local secrets file was created with a different key.");
  }
}
```

`LocalSecretStore.java` (package-private) must:

- Keep the root as a Jackson `ObjectNode`, so unknown fields survive.
- `list` reads without the lock (the file is replaced atomically), and returns
  the sorted keys of `secrets`. A missing file lists as empty.
- `read`:
  - With `key == null`, throw `LOCKED`.
  - If `keyId` differs, throw `WRONG_KEY`.
  - Decrypt with `Cipher.getInstance("AES/GCM/NoPadding")`,
    `new GCMParameterSpec(128, nonce)`, and `updateAAD(name UTF-8)`.
  - Map an `AEADBadTagException` to `WRONG_KEY`.
- The writes (`create`, `update`, `delete`):
  - Run under `withLock`: create `<file>.lock` with `CREATE_NEW`. On
    `FileAlreadyExistsException`, delete the lock if its mtime is older than 30
    000 ms; otherwise sleep 50 ms and retry, for up to 10 s, then throw
    `IOException("Timed out waiting for <lock>")`.
  - Re-read the file inside the lock.
  - With `key == null`, throw `LOCKED`. When the file exists, `keyId` must
    match, or throw `WRONG_KEY`.
  - Creating the file sets `version`, `keyId` and `keyCreated` (from the
    `clock`).
  - Write `<file>.tmp`, then
    `Files.move(tmp, file, ATOMIC_MOVE, REPLACE_EXISTING)`, falling back to a
    plain `REPLACE_EXISTING` if `ATOMIC_MOVE` is unsupported.
  - Delete the lock in `finally`.
- Create parent directories on write.
- Make `version` > 1 throw `NEWER_VERSION` on any read.
- Use `SecureRandom` for nonces. Timestamps use `DateTimeFormatter.ISO_INSTANT`
  on `clock.instant().truncatedTo(SECONDS)`.

- [ ] **Step 4: Generate the Java fixture and run the tests**

```bash
sbt "std-tests/Test/runMain org.enso.base.enso_cloud.GenerateJavaFixture"
sbt "std-tests/testOnly org.enso.base.enso_cloud.LocalSecretStoreTest"
sbt "javafmtCheckAll"
```

Expected: `java-written.json` exists, and all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/local-secrets std-bits/base/src/main/java/org/enso/base/enso_cloud/LocalSecret*.java std-bits/tests/src/test/java/org/enso/base/enso_cloud
git commit -m "Local secrets: the Java store (encrypted secrets.json) with cross-language fixtures"
```

### Task 3: Resolve `local:` ids, and the facade for Enso

**Files:**

- Create:
  `std-bits/base/src/main/java/org/enso/base/enso_cloud/LocalSecrets.java`
- Modify: `EnsoSecretReader.java` (`readSecret`, lines 38-46)
- Modify:
  `std-bits/base/src/main/resources/META-INF/native-image/org/enso/base/reflect-config.json`
- Test: extend `LocalSecretStoreTest.java`, or create `LocalSecretsTest.java`

**Interfaces:**

- Consumes: `LocalSecretStore` (Task 2).
- Produces (public, called from Enso):

```java
public final class LocalSecrets {
  public static final String ID_PREFIX = "local:";
  public static final String PATH_PREFIX = "secret://";
  public static List<String> list() throws IOException;
  public static boolean exists(String name) throws IOException;
  public static void create(String name, String value) throws IOException;
  public static void update(String name, String value) throws IOException;
  public static void delete(String name) throws IOException;
  // package-private: only EnsoSecretReader may read values.
  static String read(String name) throws IOException;
  // package-private, for tests: resolve with explicit inputs.
  static LocalSecretStore open(String fileOverride, String keyOverride, Path home, Supplier<byte[]> keychain);
  // PR 5 sets this; until then, no keychain.
  static volatile Supplier<byte[]> keychain = () -> null;
}
```

- Environment resolution: `ENSO_SECRETS_FILE` and `ENSO_SECRETS_KEY` are read
  through
  `EnsoMeta.callStaticModuleMethod("Standard.Base.System.Environment", "get", NAME)`,
  as `CloudAPI.readFromEnv` does. Then `Test_Environment` overrides reach Java.
  The default file is
  `Path.of(System.getProperty("user.home"), ".enso", "secrets.json")`.

- [ ] **Step 1: Write the failing test**

```java
@Test public void openPrefersTheEnvironmentKeyAndFile() throws Exception {
  var file = tmp.getRoot().toPath().resolve("custom.json");
  var s = LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> { throw new AssertionError("keychain must not be read"); });
  s.create("a", "1");
  assertTrue(Files.exists(file));
}

@Test public void openFallsBackToHomeAndKeychain() throws Exception {
  var home = tmp.getRoot().toPath();
  var s = LocalSecrets.open(null, null, home, () -> LocalSecretStore.decodeKey(FIXTURE_KEY));
  s.create("a", "1");
  assertTrue(Files.exists(home.resolve(".enso").resolve("secrets.json")));
}

@Test public void readSecretResolvesLocalIds() throws Exception {
  // EnsoSecretReader is package-private; the local branch must not touch CloudAPI.
  var file = tmp.getRoot().toPath().resolve("secrets.json");
  LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> null).create("a", "1");
  LocalSecrets.testOverride = () -> LocalSecrets.open(file.toString(), FIXTURE_KEY, tmp.getRoot().toPath(), () -> null);
  try {
    assertEquals("1", EnsoSecretReader.INSTANCE.readSecret("local:a"));
  } finally {
    LocalSecrets.testOverride = null;
  }
}
```

`LocalSecrets.testOverride` is a package-private
`static volatile Supplier<LocalSecretStore> testOverride`. When it is set,
`current()` uses it instead of the environment, because JUnit has no Enso
context for `EnsoMeta`. Document it as test-only.

Run the test. Expected: FAIL.

- [ ] **Step 2: Implement**

- `LocalSecrets.current()` returns the store: `testOverride` if set, otherwise
  `open(env("ENSO_SECRETS_FILE"), env("ENSO_SECRETS_KEY"), home, keychain)`.
- Every public method delegates to `current()`.
- In `EnsoSecretReader.readSecret`, before the cloud fetch:

```java
    if (secretId.startsWith(LocalSecrets.ID_PREFIX)) {
      var value = LocalSecrets.read(secretId.substring(LocalSecrets.ID_PREFIX.length()));
      secrets.put(secretId, value);
      return value;
    }
```

- Update the class Javadoc: "Internal class to read secrets from the Enso Cloud
  or the local secrets file".
- Add reflect-config entries for `org.enso.base.enso_cloud.LocalSecrets` (public
  static methods `list`, `exists`, `create`, `update`, `delete`) and
  `org.enso.base.enso_cloud.LocalSecretException` (`kind`, `getMessage`, and the
  `Kind` enum's `name`). Mirror the shape of the existing `EnsoSecretHelper`
  entry.

- [ ] **Step 3: Run the tests, format, commit**

```bash
sbt "std-tests/testOnly org.enso.base.enso_cloud.*" "javafmtCheckAll"
git add std-bits && git commit -m "Local secrets: resolve local: ids in EnsoSecretReader; the Enso-facing facade"
```

### Task 4: `Enso_Secret` local, `secret://`, and datalinks

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Enso_Secret.enso`
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Data_Link_Helpers.enso`
  (`save_password_for_data_link` and `store_as_secret`, lines 245-262)
- Create: `test/Base_Tests/src/Network/Local_Secrets_Spec.enso`
- Modify: `test/Base_Tests/src/Main.enso`

**Interfaces:**

- Consumes: the `LocalSecrets` facade and `LocalSecretException` (Task 3).
- Produces (Enso):
  - `Enso_Secret.Local internal_name id internal_path credential_metadata`
    (private)
  - `Enso_Secret_Error.Locked`, `Enso_Secret_Error.Wrong_Key`
  - The local paths `secret://<name>`

- [ ] **Step 1: Write the failing spec**

`test/Base_Tests/src/Network/Local_Secrets_Spec.enso`:

```
from Standard.Base import all
import Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret_Error
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument
import Standard.Test.Test_Environment
from Standard.Test import all

polyglot java import org.enso.base.enso_cloud.EnsoSecretAccessDenied
polyglot java import org.enso.base.enso_cloud.ExternalLibrarySecretHelper
import Standard.Base.Enso_Cloud.Enso_Secret.Derived_Secret_Value

fixture_key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

with_local_secrets ~action key=fixture_key =
    dir = File.create_temporary_file "local-secrets" ".dir"
    dir.delete
    dir.create_directory
    file = dir / "secrets.json"
    Panic.with_finalizer (dir.delete recursive=True) <|
        Test_Environment.unsafe_with_environment_override "ENSO_SECRETS_FILE" file.absolute.path <|
            Test_Environment.unsafe_with_environment_override "ENSO_SECRETS_KEY" key <|
                action

add_specs suite_builder =
    suite_builder.group "Local secrets" group_builder->
        group_builder.specify "create, get, list, update and delete" <| with_local_secrets <|
            s = Enso_Secret.create "api-token" "abc"
            s.name . should_equal "api-token"
            s.path . should_equal "secret://api-token"
            Enso_Secret.get "api-token" . should_equal s
            Enso_Secret.get "secret://api-token" . should_equal s
            Enso_Secret.list . map .name . should_equal ["api-token"]
            Enso_Secret.exists "api-token" . should_be_true
            s.update_value "def" . should_succeed
            s.delete . should_succeed
            Enso_Secret.exists "api-token" . should_be_false

        group_builder.specify "a missing secret is Not_Found" <| with_local_secrets <|
            Enso_Secret.get "nope" . should_fail_with Enso_Secret_Error

        group_builder.specify "a duplicate name is rejected" <| with_local_secrets <|
            Enso_Secret.create "dup" "1" . should_succeed
            Enso_Secret.create "dup" "2" . should_fail_with Illegal_Argument

        group_builder.specify "names follow the existing rules" <| with_local_secrets <|
            Enso_Secret.create "" "x" . should_fail_with Illegal_Argument
            Enso_Secret.create "a/b" "x" . should_fail_with Illegal_Argument
            Enso_Secret.create "connection-x" "x" . should_fail_with Illegal_Argument

        group_builder.specify "without a key, values are locked but names list" <|
            with_local_secrets (Enso_Secret.create "k" "v" . should_succeed)
            # A second environment with no key over the same kind of file:
            with_local_secrets key=Nothing <|
                Enso_Secret.create "k2" "v" . should_fail_with Enso_Secret_Error

        group_builder.specify "values never reach Enso" <| with_local_secrets <|
            s = Enso_Secret.create "hidden" "value"
            v = Derived_Secret_Value.from s
            v.to_plain_text . should_fail_with Enso_Secret_Error
            s.to_text . should_not_contain "value"
            Test.expect_panic EnsoSecretAccessDenied <|
                ExternalLibrarySecretHelper.resolveValue v

        group_builder.specify "serialises as a secret:// path" <| with_local_secrets <|
            s = Enso_Secret.create "ser" "v"
            s.to_js_object.to_text . should_contain '"path":"secret://ser"'
            s.pretty . should_equal 'Enso_Secret.get "secret://ser"'

        group_builder.specify "a datalink secretPath of secret:// resolves" <| with_local_secrets <|
            Enso_Secret.create "dl" "pw" . should_succeed
            json = JS_Object.from_pairs [["type", "secret"], ["secretPath", "secret://dl"]]
            Data_Link_Helpers.parse_secure_value json . should_equal (Enso_Secret.get "dl")
```

Add `import Standard.Base.Enso_Cloud.Data_Link_Helpers` to the imports. The
"locked" case needs one store in which a secret exists but no key is available.
`with_local_secrets` uses a fresh directory per call, so the second call starts
empty: `create` with no key must fail `LOCKED`. That is the case asserted.

If `Test_Environment.unsafe_with_environment_override` cannot set `Nothing`, use
the documented way it marks a variable unset. `Environment.get` treats a mock
key with value `Nothing` as unset (Environment.enso lines 27-35).

Add an HTTPS header test modelled on `Secrets_Spec.enso` lines 71-78. Copy
`httpbin_secure_uri` / `httpbin_secure_client` from `Cloud_Tests_Setup.enso`
lines 42-74 into a small local helper. Set
`pending=(if Environment.get "ENSO_HTTP_TEST_HTTPBIN_URL" . is_nothing then "Needs ENSO_HTTP_TEST_HTTPBIN_URL" else Nothing)`.
Assert both that the header arrives, and that the plain-HTTP fetch fails with
`Secrets are not allowed in HTTP connections, use HTTPS instead.`

Register it in `test/Base_Tests/src/Main.enso`: add
`import project.Network.Local_Secrets_Spec`, and call
`Local_Secrets_Spec.add_specs suite_builder` next to `Http_Spec.add_specs`.

Run (root `CLAUDE.md`):

```bash
cd test && JAVA_TOOL_OPTIONS="-enableassertions" ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" "Local secrets"
```

Build the distribution first with `sbt buildEngineDistribution`. Expected: the
specs FAIL. **Check that tests actually ran**: a filter that matches nothing
also exits 0.

- [ ] **Step 2: Implement in `Enso_Secret.enso`**

1. Add `polyglot java import org.enso.base.enso_cloud.LocalSecrets` and
   `polyglot java import org.enso.base.enso_cloud.LocalSecretException`.
2. Add, after `private Value …`:
   `private Local internal_name:Text id:Text internal_path:Text credential_metadata:Nothing`.
3. Add a module-private helper that calls Java and converts failures:

```
private _local ~action =
    Panic.catch LocalSecretException action caught->
        e = caught.payload
        case e.kind.name of
            "NOT_FOUND" -> Error.throw (Enso_Secret_Error.Not_Found e.getMessage)
            "LOCKED" -> Error.throw Enso_Secret_Error.Locked
            "WRONG_KEY" -> Error.throw Enso_Secret_Error.Wrong_Key
            "ALREADY_EXISTS" -> Error.throw (Illegal_Argument.Error e.getMessage)
            _ -> Error.throw (Illegal_Argument.Error e.getMessage)

private _make_local name:Text -> Enso_Secret =
    Enso_Secret.Local name "local:"+name "secret://"+name Nothing
```

The Java `create`, `update` and `delete` must put the name in their messages,
for example `A secret with the name "x" already exists.` and
`Cannot find secret: secret://x`.

4. Pull the name checks out of `create` (lines 61-63) into
   `private _validate_name name`, adding
   `if name.starts_with "secret://" then Error.throw (Illegal_Argument.Error "Secret name cannot start with 'secret://'.")`.
   Both branches of `create` use it.
5. `create`: when `parent == Nothing`:
   - validate the name
   - `Context.Output.check_enabled …` (the same message as today)
   - `_local (LocalSecrets.create name value)`
   - then `_make_local name`

   Otherwise keep the cloud body unchanged.

6. `list`: when `parent == Nothing`,
   `_local (LocalSecrets.list) . map _make_local`, wrapping the Java list with
   `Vector.from_polyglot_array` if needed. Otherwise use the cloud body.
7. `get`:
   - an `enso://` path keeps the cloud branch
   - a non-`Nothing` parent keeps the cloud relative branch
   - otherwise:

```
                local_name = if name.starts_with "secret://" then name.drop "secret://".length else name
                if _local (LocalSecrets.exists local_name) then _make_local local_name else
                    Error.throw (Enso_Secret_Error.Not_Found "secret://"+local_name)
```

8. `delete` and `update_value`: `case self of Enso_Secret.Local _ _ _ _ -> …`.
   Keep `Context.Output.check_enabled` first, then
   `_local (LocalSecrets.delete self.name)` or
   `_local (LocalSecrets.update self.name new_value)`, then
   `EnsoSecretHelper.deleteSecretFromCache self.id`, then `self`. The cloud case
   is unchanged.
9. `path self` is `self.internal_path.to_text`, which works for both.
   `to_js_object` and `pretty` need no change.
10. `Enso_Secret_Error`: add `Locked` and `Wrong_Key`, plus their
    `to_display_text` lines, using the Global Constraints messages.
11. Update the type's doc comment: "A reference to a secret stored locally
    (`secret://name`) or in the Enso Cloud (`enso://…`)."

- [ ] **Step 3: Implement in `Data_Link_Helpers.enso`**

Make `save_password_for_data_link` create a **local** secret when the datalink
location is not an `Enso_File`:

```
save_password_for_data_link data_link_location secure_value:Text|Enso_Secret name_hint:Text="password" -> Enso_Secret =
    case data_link_location of
        cloud_location : Enso_File ->
            (existing cloud body, unchanged)
        _ ->
            base_name = data_link_location.name
            location_name = if base_name.ends_with data_link_extension then base_name.drop (..Last data_link_extension.length) else base_name
            store_as_secret Nothing location_name+"-"+name_hint secure_value
```

Change `store_as_secret`'s `base_location` type to `Enso_File | Nothing`;
`Enso_Secret.create name value Nothing` creates a local secret. Check the
callers
(`git grep -n "save_password_for_data_link\|store_as_secret" distribution`) and
keep their argument types working.

- [ ] **Step 4: Run the specs and the existing secret tests**

1. Rebuild the stdlib in the distribution (`sbt buildEngineDistribution`, or
   copy `distribution/lib` changes as the repo's docs describe).
2. Run `Local_Secrets_Spec` and **check the log lists the specs**.
3. Run `test/Base_Tests` in full once.
4. Run `test/Cloud_Tests` with its usual mock setup, to prove the cloud path is
   unchanged. It needs `ENSO_HTTP_TEST_HTTPBIN_URL` and the
   `tools/http-test-helper` server, so start it as `Cloud_Tests_Setup` expects.

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add distribution/lib/Standard/Base test/Base_Tests
git commit -m "Enso_Secret: local secrets (secret://name), with datalink passwords saved locally"
```

### Task 5: Docs, changelog, PR 1

**Files:** create `docs/local-secrets.md`; modify the doc comment of
`Enso_Secret.enso`, and `CHANGELOG.md`.

- [ ] **Step 1: Write `docs/local-secrets.md`.** It covers:
  - where the file is (`~/.enso/secrets.json`, `ENSO_SECRETS_FILE`)
  - the key sources and the `LOCKED` message
  - using secrets from Enso code (`Enso_Secret.create/get/list`, `secret://`)
    and datalinks (`"secretPath": "secret://name"`)
  - servers: copy the file and set `ENSO_SECRETS_KEY`, from **Copy secrets key**
    once the app ships it
  - rotation (PR 4) and a lost key

  Link it from `Enso_Secret`'s type documentation.

- [ ] **Step 2: Add the changelog entry** under `#### Enso Standard Library`:
      `- [Secrets work without Enso Cloud: \`Enso_Secret.create\`/\`get\` keep
      them in an encrypted local file (\`secret://name\`), usable in HTTP
      headers, database credentials and datalinks.][NNN]`
- [ ] **Step 3: Run the formatting checks.**
      `sbt "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck"` and
      `corepack pnpm exec prettier --check docs/local-secrets.md CHANGELOG.md`.
- [ ] **Step 4: Commit, push, open PR 1** against `develop`, then add the PR
      number to the changelog and push. In the body, put "Part of #253", the
      spike outcome and the test evidence. It is a feature, so wait for the user
      before merging.

---

## PR 2: the app's store and Settings

### Task 6: The Node store

**Files:**

- Create: `app/project-manager-shim/src/localSecrets/crypto.ts` and `index.ts`
- Create:
  `app/project-manager-shim/src/localSecrets/__tests__/localSecrets.test.ts`
- Modify: `app/project-manager-shim/package.json` (add the export
  `"./localSecrets"`, mirroring `./localVersioning`)

**Interfaces:**

- Produces:

```ts
export type SecretsErrorKind =
  "NOT_FOUND" | "LOCKED" | "WRONG_KEY" | "ALREADY_EXISTS" | "NEWER_VERSION";
export class LocalSecretsError extends Error {
  readonly kind: SecretsErrorKind;
}
export interface LocalSecretSummary {
  readonly name: string;
  readonly created: string;
  readonly updated: string;
}
export type LocalSecretsStatus =
  | { readonly state: "empty" } // no file, or no secrets
  | { readonly state: "ready"; readonly keyCreated: string }
  | { readonly state: "missing" } // secrets but no key
  | { readonly state: "wrong" }; // secrets under another key
export interface LocalSecretsOptions {
  readonly filePath: string;
  readonly getKey: () => Buffer | null;
  readonly now?: () => Date;
}
export class LocalSecrets {
  constructor(options: LocalSecretsOptions);
  list(): Promise<readonly LocalSecretSummary[]>;
  create(name: string, value: string): Promise<void>;
  update(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  status(): Promise<LocalSecretsStatus>;
  /** Only Electron main calls these (never over HTTP). */
  reset(): Promise<void>; // deletes the file
  fileKeyId(): Promise<string | null>;
}
export function defaultSecretsFilePath(
  env: NodeJS.ProcessEnv,
  home: string,
): string;
export function encodeKey(key: Buffer): string;
export function decodeKey(text: string): Buffer;
export function keyId(key: Buffer): string;
export const SECRET_PATH_PREFIX = "secret://";
```

- [ ] **Step 1: Write the failing tests**

`localSecrets.test.ts`, in the style of `localMetadata/__tests__/labels.test.ts`
(temporary dir, `afterEach` removing it), covers:

- reads the Java fixture:
  `path.join(REPO_ROOT, 'test/fixtures/local-secrets/java-written.json')`, using
  the fixture key. Build `REPO_ROOT` from `import.meta.dirname` by going up to
  the repository root.
  - `list()` gives `['alpha', 'unicode-é']` by name.
  - Reading a value goes through a test-only export,
    `readValueForTests(store, name)`, kept in `crypto.ts` and not re-exported
    from `index.ts`. It must give `first value` and `ünïcödé ✓`.
- `create` / `update` / `delete` round trips. The written file matches the
  Global Constraints format: version 1, `keyId`, `keyCreated` and the per-secret
  fields.
- the error kinds `NOT_FOUND`, `ALREADY_EXISTS`, `LOCKED` (with
  `getKey: () => null`), `WRONG_KEY` (another key) and `NEWER_VERSION`
  (version 2)
- a value moved to another name gives `WRONG_KEY`
- unknown fields survive a write
- a stale lock (mtime set 60 s back with `fs.utimes`) is taken over, and the
  lock is gone after a write
- `status()`: `empty` with no file; `ready` with `keyCreated`; `missing` with
  secrets and no key; `wrong` with secrets and another key
- `defaultSecretsFilePath({ENSO_SECRETS_FILE: '/x'}, '/home')` gives `/x`, and
  `defaultSecretsFilePath({}, '/home')` gives `/home/.enso/secrets.json` (use
  `path.join`)
- names: empty, `a/b`, `connection-x` and `secret://x` are rejected with `Error`
  (not `LocalSecretsError`)
- a file **without `keyCreated`** (one written by the engine on a server, say):
  `status()` reports `ready` with `keyCreated` = `now()`, and writes it into the
  file under the lock. A second `status()` returns the same value, so the key's
  age counts from the first time the app saw it (spec, section 1).

Run:
`cd app/project-manager-shim && corepack pnpm exec vitest run src/localSecrets`.
Expected: FAIL.

- [ ] **Step 2: Implement**

`crypto.ts` holds `encrypt(key, name, value) -> {nonce, value}` and
`decrypt(key, name, entry) -> string`, using `aes-256-gcm`,
`setAAD(Buffer.from(name, 'utf8'))`, and ciphertext‖tag. It also holds `keyId`,
`encodeKey` and `decodeKey`, with `decodeKey` rejecting anything but 32 bytes.

`index.ts`:

- Write under an in-process `serialised(filePath, …)` (from
  `../localMetadata/jsonFile.js`) **and** the cross-process lock file:
  `fs.open(lock, 'wx')`, stale after 30 000 ms, retry every 50 ms for up to 10
  s.
- Write `<file>.tmp`, then rename it with `renameWithRetry` from `jsonFile.ts`,
  which handles Windows file locks.
- Keep the file's object as parsed, so unknown fields survive.
- Name validation uses the Global Constraints rules.

- [ ] **Step 3: Run the tests, typecheck, lint**

```bash
corepack pnpm exec vitest run src/localSecrets && corepack pnpm exec tsc --noEmit -p . && corepack pnpm exec eslint src/localSecrets
```

Also run it in WSL. Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app/project-manager-shim && git commit -m "Local secrets: the Node store, reading the Java-written fixture"
```

### Task 7: Shim routes, `ProjectManager` / `LocalBackend`, and the key for engines

**Files:**

- Modify: `app/project-manager-shim/src/handler/projectService.ts` (a
  `SECRET_ROUTES` table and a `localSecrets?` parameter, mirroring
  `LOCAL_METADATA_ROUTES`, lines 21-28 and 204-248)
- Modify: `app/project-manager-shim/src/projectService/index.ts`
  (`projectEnvVars`, lines 194-204, and the constructor or `default` factory):
  an `extraEnvironment` option
- Modify: `app/common/src/services/ProjectManager/ProjectManager.ts` and
  `LocalBackend.ts` (lines 1108-1131)
- Test: `app/project-manager-shim/src/handler/__tests__/projectService.test.ts`,
  and a `LocalBackend` test where secrets live (`common/src/services/__test__/`)

**Interfaces:**

- **Routes** (`POST /api/project-service/…`, JSON-RPC as the others):
  - `secrets/list` returns `LocalSecretSummary[]`
  - `secrets/create {name, value}` returns `null`
  - `secrets/update {name, value}` returns `null`
  - `secrets/delete {name}` returns `null`
  - `secrets/status` returns `LocalSecretsStatus` plus
    `{ keyFromEnvironment: boolean }`
- **ProjectService:** `ProjectService.default(…)` gains a trailing optional
  `extraEnvironment?: () => readonly (readonly [string, string])[]`, whose
  entries `projectEnvVars` appends.
- **`ProjectManager`:** `listSecrets()`, `createSecret(name, value)`,
  `updateSecret(name, value)`, `deleteSecret(name)` and `secretsStatus()`.
- **`LocalBackend`:**
  - `createSecret(body)` returns `SecretId('local:'+body.name)` (ignoring
    `parentDirectoryId`)
  - `updateSecret(id, body)` uses the name after `local:`, and `body.value`
    (title changes are not supported)
  - `getSecret(id, title)` returns `{ id, value: '' }`, because values are never
    read back
  - `listSecrets()` returns
    `SecretInfo { name, id: SecretId('local:'+name), path: 'secret://'+name }`
  - new `deleteLocalSecret(name)` and `secretsStatus()`
  - `createCredential` stays `invalidOperation()`

- [ ] **Step 1: Write the failing tests**

- **Handler:** in `projectService.test.ts`, following its existing request
  helper:
  - `secrets/create` then `secrets/list` returns the name
  - no route returns a value: assert the JSON of every response lacks the
    created value string
  - with no `localSecrets` store, the response is the "Local secrets are not
    available in this host." error
- **`LocalBackend`:** with a mocked `ProjectManager` (as other `LocalBackend`
  tests do):
  - `listSecrets` maps to `secret://` paths and `local:` ids
  - `createSecret` returns `local:<name>`
- **`ProjectService`:** `projectEnvVars` includes `extraEnvironment()` entries.
  Test it through `openProject` with a fake runner, if one exists in
  `projectService/__tests__`. Otherwise test through a small exported pure
  helper.

Run the shim and common test suites for these files. Expected: FAIL.

- [ ] **Step 2: Implement**

Follow the route-table pattern exactly. Add `localSecrets?: LocalSecrets` as the
last parameter of `handleProjectServiceRequest`, after `localVersioning`, and
thread it through `Server` (`server.ts` lines 194-215 and 278-288) the way
`localVersioning` is. `secrets/status` returns
`{ ...(await store.status()), keyFromEnvironment }`, where `keyFromEnvironment`
is a constructor option of the route context. Pass it as
`({ store, keyFromEnvironment }, body)`, as the versioning block wraps its
store.

- [ ] **Step 3: Run the tests and typecheck; commit**

```bash
git add app/project-manager-shim app/common && git commit -m "Local secrets: shim routes, LocalBackend and ProjectManager methods, engine environment hook"
```

### Task 8: The key in Electron main

**Files:**

- Create: `app/electron-client/src/secretsKey.ts` and
  `tests/headless/secretsKey.test.ts`
- Modify: `app/electron-client/package.json` (`@napi-rs/keyring`, exact version,
  with the reason recorded), `src/projectService.ts`, `src/index.ts` and
  `src/server.ts`
- Modify: `src/ipc.ts`, `src/preload.ts`, `src/electron.ts` and
  `app/gui/src/electronApi.ts` (a `secrets` namespace: `status`, `copyKey`,
  `reset`)

**Interfaces:**

- Consumes: `LocalSecrets` and its helpers (Task 6), and the spike's keychain
  identity (Task 1).
- Produces:

```ts
export interface KeyringEntryLike {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}
export interface SecretsKeySourceOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly entry: (account: string) => KeyringEntryLike; // service is always 'Enso'
  readonly fileKeyId: () => Promise<string | null>; // from LocalSecrets
  readonly fileHasSecrets: () => Promise<boolean>;
}
export class SecretsKeySource {
  constructor(options: SecretsKeySourceOptions);
  readonly fromEnvironment: boolean;
  /** Called once at start-up: creates the keychain key when there is nothing to lose (see the plan). */
  initialise(): Promise<void>;
  /** The key, or null; never creates one. */
  current(): Buffer | null;
  /** The key as unpadded base64url, for "Copy secrets key"; null when there is none. */
  exportKey(): string | null;
  /** Deletes the keychain key; the caller deletes the file and then calls initialise(). */
  forget(): void;
}
```

- GUI API:

```ts
export interface SecretsApi {
  readonly copyKey: () => Promise<boolean>; // copies to the clipboard in main; false when there is no key
  readonly reset: () => Promise<void>; // deletes the file and the key, then creates a new key
}
```

The key never crosses into the renderer: main writes it to the clipboard itself
with `clipboard.writeText`. Status comes from the shim route.

- [ ] **Step 1: Write the failing tests**

`tests/headless/secretsKey.test.ts`, with an in-memory fake keyring
(`Map<string, string>`) behind `entry`:

- `ENSO_SECRETS_KEY` set: `fromEnvironment` is true, `current()` returns it, and
  `initialise()` never touches the keyring (the fake throws on use).
- No environment key, no item, no file: `initialise()` creates a 32-byte key
  under account `secrets-key`, and `current()` returns it.
- No environment key, no item, but a file **with secrets**: `initialise()`
  creates nothing, and `current()` is null.
- An existing item is reused.
- `exportKey()` round-trips through `decodeKey`.
- `forget()` deletes the item.

Run it. Expected: FAIL.

- [ ] **Step 2: Implement**

Write `secretsKey.ts` as specified. Then wire it in `projectService.ts`:

```ts
export function getSecretsKeySource(): SecretsKeySource;
export function getLocalSecrets(): LocalSecrets;
```

These are lazy singletons, like `getLocalMetadata`, with:

- `filePath: defaultSecretsFilePath(process.env, os.homedir())`
- `getKey: () => getSecretsKeySource().current()`
- `entry: (account) => new Entry('Enso', account)`

Use the spike's convention if it differs.

Pass the engine environment to `ProjectService.default` as
`() => { const key = getSecretsKeySource().current(); return key ? [['ENSO_SECRETS_KEY', encodeKey(key)]] : [] }`.

In `index.ts`, `await getSecretsKeySource().initialise()` before the server
starts. Pass `getLocalSecrets()` and `keyFromEnvironment` to `Server.create`.

IPC handlers in `electron.ts`, `initIpc`:

```ts
ipcMain.handle(Channel.secretsCopyKey, () => {
  const key = getSecretsKeySource().exportKey();
  if (key == null) return false;
  clipboard.writeText(key);
  return true;
});
ipcMain.handle(Channel.secretsReset, async () => {
  await getLocalSecrets().reset();
  getSecretsKeySource().forget();
  await getSecretsKeySource().initialise();
});
```

Add the channels `secretsCopyKey = 'secrets-copy-key'` and
`secretsReset = 'secrets-reset'`, each with a direction JSDoc. Add the preload
`secrets` object, and `SecretsApi` / `ElectronApi.secrets` in
`gui/src/electronApi.ts`.

- [ ] **Step 3: Run the tests, typecheck both packages, and check the build**

```bash
cd app/electron-client && corepack pnpm exec vitest run && corepack pnpm exec tsc --noEmit -p .
cd ../gui && corepack pnpm run typecheck
```

Then build the IDE once, with the memory `local-windows-installer-build` recipe,
and check the packaged app starts. `@napi-rs/keyring` is a native module:
confirm esbuild bundling plus its `.node` binary work in the packaged app. If
esbuild cannot bundle it, mark it external and add it to electron-builder's
`files` / `asarUnpack`. Record what was needed.

- [ ] **Step 4: Commit**

```bash
git add app/electron-client app/gui/src/electronApi.ts pnpm-lock.yaml
git commit -m "Local secrets: the master key in Electron main (keychain), passed to engines; copy and reset over IPC"
```

### Task 9: Settings → Local → Secrets

**Files:**

- Create: `app/gui/src/dashboard/layouts/Settings/SecretsSettingsSection.vue`
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts` (a new section in
  `LOCAL_TAB.sections`, after `localVersionsSettingsSection`)
- Modify: `app/common/src/text/english.json`
- Test:
  `app/gui/src/dashboard/layouts/Settings/__tests__/SecretsSettingsSection.test.ts`

**Interfaces:**

- Consumes:
  `LocalBackend.listSecrets / createSecret / updateSecret / deleteLocalSecret / secretsStatus`
  (Task 7), `window.api.secrets.copyKey / reset` (Task 8), `UpsertSecretModal`
  (`onCreate(name, value)`), `useModals().open / ask`, `ConfirmDeleteModal`, and
  `useToasts().show`.

- [ ] **Step 1: Write the failing component test**

Follow `LocalVersionsSettingsSection`'s tests if they exist, otherwise
`SettingsPage.test.ts`. Mount the section with a fake local backend that records
calls, and check:

- With two secrets, both names show, and **no value** appears in
  `document.body.textContent`. The fake's list has no values to show, but assert
  it anyway.
- **New secret** opens the modal. Submitting `x` / `v` calls
  `createSecret({ name: 'x', value: 'v', parentDirectoryId: null })`, and the
  list refetches.
- **Change value** on `x` calls
  `updateSecret(SecretId('local:x'), { title: null, value: 'w' }, 'x')`.
- **Delete** asks through `ConfirmDeleteModal`, then calls
  `deleteLocalSecret('x')`.
- **Copy secrets key** confirms a warning first, then calls
  `window.api.secrets.copyKey`, and toasts `secretsKeyCopied`.
- With `secretsStatus` `missing` or `wrong`, a message shows with **Reset
  secrets**. Confirming calls `window.api.secrets.reset`. With `ready`, no Reset
  button shows.
- With `keyFromEnvironment`, the note `secretsKeyFromEnvironment` shows.

Run:
`cd app/gui && corepack pnpm exec vitest run src/dashboard/layouts/Settings`.
Expected: FAIL.

- [ ] **Step 2: Implement**

Model it on `LocalVersionsSettingsSection.vue`:

- `useSettingsContext`, `useQuery` for the list and the status, with keys
  `['localSecrets', 'list']` and `['localSecrets', 'status']`.
- `useMutation` for changes, and `toasts.show` on error.
- The root is `data-testid="local-secrets-section"`.
- Each row is the name, with small outline buttons **Change value** and
  **Delete**.

In `english.json`, add next to `localVersionsSettingsSection`:

```json
"secretsSettingsSection": "Secrets",
"secretsSettingsCustomEntryAliases": "secrets\npasswords\napi keys\ncredentials",
"secretsNone": "No secrets yet. Secrets are encrypted on this computer and can be used in workflows and datalinks.",
"secretsChangeValue": "Change value",
"secretsDeleteActionText": "delete the secret '$0'",
"secretsCopyKey": "Copy secrets key",
"secretsCopyKeyWarning": "Anyone with this key and your secrets file can read every secret. Copy it only to set ENSO_SECRETS_KEY on a server you trust.",
"secretsKeyCopied": "The secrets key is on the clipboard.",
"secretsKeyMissing": "Your secrets cannot be read: their key is not on this computer. Set ENSO_SECRETS_KEY, or reset your secrets.",
"secretsKeyWrong": "Your secrets were saved with a different key. Set ENSO_SECRETS_KEY to that key, or reset your secrets.",
"secretsReset": "Reset secrets",
"secretsResetActionText": "delete every secret and start with a new key",
"secretsKeyFromEnvironment": "The key is set by ENSO_SECRETS_KEY.",
```

Register the section in `tabs.ts`:

```ts
{
  nameId: 'secretsSettingsSection',
  entries: [
    { type: 'custom', aliasesId: 'secretsSettingsCustomEntryAliases', component: SecretsSettingsSection },
  ],
},
```

- [ ] **Step 3: Run the tests, typecheck and lint; commit**

```bash
corepack pnpm exec vitest run src/dashboard/layouts/Settings && corepack pnpm run typecheck
git add app/gui app/common/src/text/english.json && git commit -m "Settings: Local → Secrets (new, change, delete, copy key, reset)"
```

### Task 10: Changelog, end-to-end check, PR 2

- [ ] **Step 1: Add the changelog entry** under `#### Enso IDE`:
      `- [Secrets without Enso Cloud: create and manage encrypted secrets in Settings → Local → Secrets, and use them in workflows.][NNN]`
- [ ] **Step 2: Run the end-to-end check on the installed build** (Windows):
  1. Build and install the IDE.
  2. Settings → Secrets → New secret `httpbin-token`.
  3. In a project, run
     `Data.fetch "https://httpbin.org/headers" headers=[Header.new "X-Token" (Enso_Secret.get "httpbin-token")]`
     and check the value is echoed.
  4. Copy the key. In WSL, set `ENSO_SECRETS_KEY` and `ENSO_SECRETS_FILE`
     (pointing at the Windows file through
     `/mnt/c/Users/<user>/.enso/secrets.json`) and run the same code with the
     WSL engine build.
  5. Record both results.
- [ ] **Step 3: Open PR 2**, based on PR 1's branch. Smoke-test the installer
      (memory `local-windows-installer-build`, item 5), hand it to the user, and
      wait.

---

## PR 3: secrets in the editors

### Task 11: The datalink editor's secret picker

**Files:**

- Create: `app/gui/src/providers/localSecrets.ts`, which exports
  `useLocalSecretsQuery()` (the list query from Task 9, shared) and
  `useCreateLocalSecret()` (a mutation that invalidates it). Make Task 9's
  section use them too; refactor it in this task.
- Create: `app/gui/src/datalinks/SecretPicker.vue`
- Modify: `app/gui/src/datalinks/DatalinkInput.vue` (lines 26-34: remove the
  `EnsoSecret` entry and its comment line) and `JSONSchemaInput.vue` (lines 7-8
  and 230-239)
- Modify: `english.json` (delete `datalinkSecretsUnavailable`)
- Test: `app/gui/src/datalinks/__tests__/` (extend the existing
  `JSONSchemaInput` / `DatalinkInput` tests)

**Interfaces:**

- `SecretPicker.vue` takes the props `value: string | null` (a `secret://` path)
  and `readOnly`, and emits `change: [path: string]`. It renders a dropdown of
  local secret names, plus **New secret…**, which opens `UpsertSecretModal` and,
  on create, emits the new `secret://` path.

- [ ] **Step 1: Write the failing tests**
  - A `SecureValue` field offers "Plain text" and "Secret" (the `EnsoSecret`
    member is no longer hidden).
  - Choosing "Secret" shows the picker, and picking `db` emits
    `{ type: 'secret', secretPath: 'secret://db' }` for that field.
  - **New secret…** creates through the backend, then selects it.
  - An existing plain-text value still edits as text.
  - In read-only mode the picker is disabled.

  Run the datalink tests. Expected: FAIL.

- [ ] **Step 2: Implement.** In `JSONSchemaInput.vue`, replace the read-only
      `SchemaTextInput` for `schemaFormat === 'enso-secret'` with
      `<SecretPicker :value="value" :readOnly="readOnly" @change="onChange" />`,
      and update the file's doc comment (lines 7-8). In `DatalinkInput.vue`,
      remove the `EnsoSecret` entry. The `secretPath` format string stays as
      `enso-secret` in the schema.
- [ ] **Step 3: Run the tests, typecheck, and the datalink Playwright spec** if
      one exists (`git grep -l datalink app/gui/e2e`). Then commit:
      `git commit -m "Datalink editor: pick or create a local secret for secure values"`.

### Task 12: The graph editor: pick or create a secret

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser/localSecrets.ts`
- Modify: `WidgetFileBrowser.vue` (lines 86-92: add the new items) and
  `localBrowser.ts` (lines 75-76: remove the `assert(rawKind !== 'secret')`;
  `LABELS` already skips secrets)
- Modify: `browsableTypes.ts`, only `withBrowserItems`' JSDoc, which says there
  is no secret browser
- Modify: `app/gui/src/secrets/CLAUDE.md`, which is no longer dormant except for
  the OAuth forms
- Test: next to the existing `WidgetFileBrowser` tests

**Interfaces:**

- Produces
  `useLocalSecretItems({ dialogKind, setPath }): ComputedRef<CustomDropdownItem[]>`.
  - For `dialogKind === 'secret'`, it returns one item per local secret,
    labelled with the name, whose action calls
    `setPath('secret', 'secret://'+name)`.
  - It adds a **New secret…** item (icon `key_add`) that opens
    `UpsertSecretModal` and, on create, calls `setPath` with the new path.
  - Otherwise it returns `[]`.
  - Build the items the way `useLocalBrowser` builds its `CustomDropdownItem`s.

- [ ] **Step 1: Write the failing tests**
  - A `Secret_Browse` argument's dropdown lists the local secrets and **New
    secret…**.
  - Choosing `db` sets the argument to `Enso_Secret.get 'secret://db'`; check
    the edit that `setPath` makes.
  - **New secret…** creates through the backend and sets the path.
  - A file argument shows no secret items.

  Run them. Expected: FAIL.

- [ ] **Step 2: Implement**, as specified, using `useLocalSecretsQuery` /
      `useCreateLocalSecret` from Task 11. Keep `useTextSecrets`' "Provide
      secret as text" item.
- [ ] **Step 3: Run the tests**, typecheck, and the graph-editor widget
      Playwright spec, if one covers `WidgetFileBrowser`. Commit:
      `git commit -m "Graph editor: pick or create a local secret for Enso_Secret arguments"`.
- [ ] **Step 4: Open PR 3**, based on PR 2, with the label
      `CI: No changelog needed`. In the body, write "described by PR 2's
      changelog entry", and include before and after screenshots of both pickers
      (memory `pr-screenshots-rule`).

---

## PR 4: rotation and reminders

### Task 13: Crash-safe rotation

**Files:**

- Modify: `app/project-manager-shim/src/localSecrets/index.ts`, adding
  `rotate(oldKey: Buffer, newKey: Buffer): Promise<void>`. It re-encrypts every
  value under the lock and writes the new `keyId` and `keyCreated`.
- Modify: `app/electron-client/src/secretsKey.ts`, adding
  `rotate(store: LocalSecrets): Promise<void>` and recovery inside
  `initialise()`.
- Modify: IPC, adding the channel `secretsRotate = 'secrets-rotate'` and
  `SecretsApi.rotate: () => Promise<void>`. It rejects with
  `Close open projects to rotate the key.` when any project is running. Ask
  `ProjectService` for running projects. If there is no such method, add
  `hasRunningProjects()` to `ProjectService` / `EnsoRunner`, based on the child
  processes they track.
- Test: `localSecrets.test.ts` and `secretsKey.test.ts`

**The rotation steps,** `SecretsKeySource.rotate`:

1. `const newKey = randomBytes(32)`
2. `entry('secrets-key-next').setPassword(encodeKey(newKey))`
3. `await store.rotate(oldKey, newKey)`
4. `entry('secrets-key').setPassword(encodeKey(newKey))`, then
   `entry('secrets-key-next').deletePassword()`

**Recovery,** in `initialise()`, when not `fromEnvironment`: if
`secrets-key-next` exists, then:

- if `keyId(next) === fileKeyId`, promote it (set `secrets-key` and delete
  `-next`)
- otherwise delete `-next`, because the rotation never reached step 3

- [ ] **Step 1: Write the failing tests**
  - `store.rotate` re-encrypts, so values read with the new key and not the old
    one, and `keyCreated` is updated.
  - `rotate` with the wrong old key gives `WRONG_KEY`, and the file is
    unchanged.
  - **Crash after step 2:** the fake keyring has `-next` and the file is still
    under the old key. `initialise()` deletes `-next` and keeps the old key.
  - **Crash after step 3:** the file is under the new key. `initialise()`
    promotes `-next`, and values read.
  - A full rotation leaves one keychain item and a readable file.
  - With `fromEnvironment`, `rotate` throws
    `The key is set by ENSO_SECRETS_KEY.`

  Run them. Expected: FAIL.

- [ ] **Step 2: Implement** as specified.
- [ ] **Step 3: Run the tests and typecheck; commit**:
      `git commit -m "Local secrets: crash-safe key rotation with a pending keychain item"`.

### Task 14: Rotate in Settings, and the age reminders

**Files:**

- Modify: `SecretsSettingsSection.vue`:
  - a **Rotate key** button, disabled with `secretsRotateCloseProjects` while
    any project is open (use the GUI's opened-projects state; find it with
    `git grep -n "openedProjects\|useOpenedProjects" app/gui/src | head`)
  - the year-old banner
- Create: `app/gui/src/composables/secretsKeyReminder.ts` and
  `app/gui/src/secrets/SecretsKeyReminderToast.vue`
- Modify: `app/gui/src/App.vue` (call `useSecretsKeyReminder()` next to
  `useOfflineNotification()`, lines 83-88)
- Modify: `english.json`
- Test: the section's tests, and
  `app/gui/src/composables/__tests__/secretsKeyReminder.test.ts`

**Interfaces:**

- `secretsKeyReminder.ts` exports:
  - `isKeyDue(keyCreated: string, now: Date, snoozedUntil: string | null): boolean`,
    which is true when `now - keyCreated >= 365 days` and
    (`snoozedUntil == null || now >= snoozedUntil`)
  - `snoozeForAMonth(now: Date): void`, which stores `now + 30 days` in a
    `createPersistedStore` named `enso-secrets-reminder`
  - `useSecretsKeyReminder()`, which on mount reads the status once through the
    local backend. When it is `ready`, not `keyFromEnvironment`, and `isKeyDue`,
    it shows a toast with `{ component: SecretsKeyReminderToast }`,
    `autoClose: false`.
- The toast has **Rotate**, which opens Settings → Local (the GUI's settings
  navigation) and dismisses, and **Remind me in a month**, which calls
  `snoozeForAMonth` and dismisses.

- [ ] **Step 1: Write the failing tests**
  - `isKeyDue`:
    - 364 days → false
    - 365 days → true
    - snoozed until tomorrow → false
    - snoozed until yesterday → true
  - The composable shows the toast only when due and not from the environment.
    Snoozing stores now + 30 days.
  - The section shows the banner when due. **Rotate key** is disabled while a
    project is open, and otherwise confirms and calls
    `window.api.secrets.rotate`, then refetches the status. With
    `keyFromEnvironment`, no Rotate button shows.

  Run them. Expected: FAIL.

- [ ] **Step 2: Implement.** Add these keys to `english.json`:

```json
"secretsRotateKey": "Rotate key",
"secretsRotateActionText": "re-encrypt every secret with a new key. Servers using the old key will need the new key and the new secrets file",
"secretsRotateCloseProjects": "Close open projects to rotate the key.",
"secretsKeyOld": "Your secrets key is over a year old.",
"secretsRotateNow": "Rotate now",
"secretsRemindInAMonth": "Remind me in a month",
"secretsKeyRotated": "The secrets key has been rotated.",
```

- [ ] **Step 3: Run the tests**, the GUI suite and the typecheck. Add a
      Playwright test for rotation in Settings if Settings already has e2e
      coverage. Commit:
      `git commit -m "Settings: rotate the secrets key; yearly reminder, then monthly"`.
- [ ] **Step 4: Open PR 4**, based on PR 3, with the label
      `CI: No changelog needed` (under PR 2's entry) and screenshots. Hand the
      installer to the user.

---

## PR 5: the desktop command-line keychain (only if Task 1 passed)

### Task 15: java-keyring for the engine

**Files:**

- Create: `lib/java/keyring-wrapper/`. Define it in `build.sbt` like
  `jna-wrapper` (lines 1337-1360): `JPMSPlugin`, `modularFatJarWrapperSettings`,
  and the java-keyring dependency pinned in `project/Dependencies.scala` with a
  comment giving the reason.
- Modify: `std-base` in `build.sbt`: depend on `keyring-wrapper` and
  `jna-wrapper` as `provided`, and ship the extracted JNA natives as
  `std-microsoft` does (lines 6030-6099).
- Modify: `rebuildNativeImage` (around `build.sbt` 3830-3990), if the spike
  showed that is needed, and `reflect-config.json`.
- Modify: `std-bits/base/.../LocalSecrets.java`, setting the `keychain` supplier
  to read `Enso` / `secrets-key` with the spike's convention. Failures return
  `null`, so the store reports `LOCKED`.
- Test: a JUnit test with a fake supplier (the supplier wiring), plus a manual
  run.

- [ ] **Step 1: Write the failing test.** `LocalSecrets.keychain` returns the
      key stored under the convention, using a fake behind an interface
      (`KeychainReader`) so JUnit needs no real keychain. Expected: FAIL.
- [ ] **Step 2: Implement.** Make the wrapper and the dependencies. The supplier
      calls the wrapper through `KeychainReader`.
- [ ] **Step 3: Verify for real**:
  1. Build the native launcher.
  2. On Windows, with no `ENSO_SECRETS_KEY`, run `enso --run` on a script that
     reads a secret created in the app. Expected: the value is used. Check with
     an HTTPS echo, as in Task 10.
  3. Repeat in WSL with `gnome-keyring` unlocked.
  4. Without a keyring daemon, expect the `LOCKED` message.

  Run the formatting checks, and `sbt buildEngineDistribution` with the native
  launcher.

- [ ] **Step 4: Update `docs/local-secrets.md`** ("On the desktop, `enso` reads
      the key from your keychain; macOS asks once"). Open PR 5, based on PR 1's
      branch, retargeted as needed, with the label `CI: No changelog needed`,
      under PR 1's stdlib entry.

**If Task 1 failed:** this task instead updates `docs/local-secrets.md` to say
that desktop command-line use needs `ENSO_SECRETS_KEY`, and adds that line to PR
1, or to a follow-up docs PR if PR 1 has merged.
