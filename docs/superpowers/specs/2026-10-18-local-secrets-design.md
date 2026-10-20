# Local secrets: design

Date: 2026-10-18. Status: draft, for review.

## Goal

Give the local-only IDE secrets that work without Enso Cloud:

1. **Enso code uses them:** `Enso_Secret.get "name"` (or `secret://name`) in
   HTTP headers, JDBC credentials and anything else that takes an `Enso_Secret`.
   The value never reaches Enso code.
2. **Datalinks use them:** a local `.datalink` file can refer to a secret
   instead of holding a password in plain text.
3. **They work outside the IDE too:** the `enso` command line on the desktop,
   and servers, CI and scheduled runs.
4. **The user manages them in the app:** Settings → Local → Secrets (create,
   change, delete, rotate the key), plus pickers in the datalink and graph
   editors.

## Background

- **How the engine reads a secret today.** `Enso_Secret` is an opaque handle:
  name, cloud asset id and `enso://` path
  (`distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Enso_Secret.enso`).
  The value is fetched in Java at one choke point:
  - `SecretValueResolver` → `EnsoSecretReader.readSecret(secretId)`, in
    `std-bits/base/src/main/java/org/enso/base/enso_cloud/`.
  - That makes the call `GET <ENSO_CLOUD_API_URL>/s3cr3tz/<id>` with the cloud
    access token from `~/.enso/credentials`.
  - Leak protection works on the value after it is read: plain-HTTP refusal,
    `__SECRET__` rendering, `Access_Denied` in `to_plain_text`, and the
    restricted external-library API.
- **It is broken in the local-only IDE.** The local-only work removed the
  Electron writer of `~/.enso/credentials`, so `Enso_Secret.get` fails.
- **The datalink editor stores secrets as plain text.** Datalinks hold
  `{"type": "secret", "secretPath": "enso://…"}`
  (`app/gui/src/utils/datalinkSchema.json`). The local datalink editor (#246)
  lists `EnsoSecret` in `UNAVAILABLE_SCHEMAS` and saves secure values as plain
  text, with a note.
- **The secrets UI is dormant, not deleted** (`app/gui/src/secrets/`). Nothing
  opens it. `LocalBackend`'s secret methods throw, and `listSecrets` returns
  `[]`.
- **No encrypted storage exists in the app yet.**

## Decisions

| Question               | Decision                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usable from            | Enso code and datalinks.                                                                                                                                                                                                               |
| Outside the IDE        | Yes: the desktop command line reads the OS keychain; servers use a copied file plus `ENSO_SECRETS_KEY`.                                                                                                                                |
| Namespace              | One flat, per-user list of named secrets, shared by all projects.                                                                                                                                                                      |
| Storage                | One encrypted file, `~/.enso/secrets.json`, with AES-256-GCM values and one master key. Rejected: one OS-keychain item per secret (a macOS access prompt per secret per binary, and no keychain on headless Linux); a plain-text file. |
| Master key             | `ENSO_SECRETS_KEY` if set, else the OS keychain item `Enso` / `secrets-key`. Only the app creates the keychain item.                                                                                                                   |
| Path form              | `secret://<name>`. A bare name and `secret://` are always local; only an explicit `enso://` path still reaches the cloud code. Removing Enso Cloud from the stdlib is later, separate work.                                            |
| Reading values back    | The app never reads a value back, as with the cloud. Only the engine decrypts in order to use a value.                                                                                                                                 |
| Key rotation           | In Settings, crash-safe. Reminders start once the key is a year old and repeat monthly.                                                                                                                                                |
| OAuth credential forms | Stay dormant: they need client ids from the removed cloud config.                                                                                                                                                                      |

## Design

### 1. The store

**File:** `~/.enso/secrets.json` on every OS. `ENSO_SECRETS_FILE` overrides the
location.

```json
{
  "version": 1,
  "keyId": "3f9a1c2e7b4d8e01",
  "keyCreated": "2026-10-18T14:02:11Z",
  "secrets": {
    "snowflake-password": {
      "nonce": "<base64, 12 bytes>",
      "value": "<base64 AES-256-GCM ciphertext and 16-byte tag>",
      "created": "2026-10-18T14:02:11Z",
      "updated": "2026-10-18T14:02:11Z"
    }
  }
}
```

- **Encryption:** each value is encrypted separately with AES-256-GCM, a fresh
  random 12-byte nonce, and the **secret's name (UTF-8) as associated data**, so
  a ciphertext moved to another name fails to decrypt.
- **`keyId`:** the first 8 bytes of SHA-256 of the key, in hex. A mismatch gives
  `Wrong_Key`, not a decryption failure.
- **`keyCreated`:** set when a key is created or rotated. A file without it
  counts from the first time the app sees it, and the app then writes it.
- **Names:** visible, so listing needs no key. They follow the stdlib's existing
  secret-name validation.
- **Unknown fields:** a newer `version` is refused, read-only, with a clear
  error. Unknown fields at the current version are preserved.

**Master key:** 32 random bytes, shown and accepted as unpadded base64url.

1. `ENSO_SECRETS_KEY`, if set (any process).
2. The OS keychain item, service `Enso`, account `secrets-key`. Windows
   Credential Manager, macOS Keychain, Linux Secret Service.
3. Otherwise the store is **locked**. Reading and writing values fail with
   `Locked`: "Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the
   desktop where they were created." Listing still works.

**Writing** (app and engine alike):

1. Create `secrets.json.lock` exclusively. A lock older than 30 s is stale and
   taken over.
2. Re-read the file.
3. Apply the change.
4. Write `secrets.json.tmp` and rename it over `secrets.json`.
5. Remove the lock.

**Lost key:** values cannot be recovered. The app offers **Reset secrets**,
which deletes the file and creates a new key, behind a confirmation.

### 2. Engine and standard library

**Java** (`std-bits/base`, a new package `org.enso.base.enso_cloud.local`):

- `LocalSecretStore`, with `list()`, `read(name)`, `create(name, value)`,
  `update(name, value)` and `delete(name)`. It implements section 1 and reads
  `ENSO_SECRETS_KEY` / `ENSO_SECRETS_FILE` through Enso's `Environment.get`,
  which test environment overrides reach.
- **Key lookup** after `ENSO_SECRETS_KEY`: the keychain through a `lib/java/`
  wrapper around java-keyring (section 4).
- **`EnsoSecretReader.readSecret(id)`:** an id of the form `local:<name>` reads
  through `LocalSecretStore`. Every other id keeps the cloud fetch. Caching and
  `deleteSecretFromCache` behave the same for both.
- **Creating the file on a server:** if `ENSO_SECRETS_KEY` is set and the file
  does not exist, `create` creates it with that key. With no key, `create` fails
  with `Locked`; the engine never generates a key.

**Enso** (`Enso_Cloud/Enso_Secret.enso`):

- **A private constructor `Local name:Text`** beside the cloud `Value`. Its Java
  id is `local:<name>`.
- **Routing:**

  | Call                                  | Store          |
  | ------------------------------------- | -------------- |
  | `get "secret://x"`, `get "x"`         | local          |
  | `get "enso://…"`                      | cloud (as now) |
  | `create name value` (no parent)       | local          |
  | `list` (no parent)                    | local          |
  | `create` / `list` with a cloud parent | cloud (as now) |

- **On `Local`:**
  - `update_value` and `delete` act on the file.
  - `list` returns secrets sorted by name.
  - `to_js_object` gives
    `{"type":"Enso_Secret","constructor":"get","path":"secret://x"}`.
  - `pretty` gives `Enso_Secret.get "secret://x"`.
- **`Enso_Secret_Error`** gains `Not_Found name`, `Locked` and `Wrong_Key`.
- **`Derived_Secret_Value`** is unchanged: its `Secret_Value` carries the id,
  now `local:<name>` for local secrets.

**Datalinks** (`Enso_Cloud/Data_Link_Helpers.enso`):

- `parse_secure_value` already resolves `secretPath` through `Enso_Secret.get`,
  so `secret://x` works with no change.
- `save_password_for_data_link` creates a local secret named
  `<datalink name>-password` (adding `-2`, `-3`… if the name is taken), and
  writes `{"type": "secret", "secretPath": "secret://<name>"}`.

The graph editor's `make_text_secret_selector` lists through `Enso_Secret.list`,
so it shows local secrets.

### 3. The app

**Store module:** `app/project-manager-shim/src/localSecrets/`. This is section
1 in Node (`crypto`, AES-256-GCM), using the shim's existing `jsonFile.ts`
helpers where they fit. Endpoints under `/api/project-service/secrets/`:

- `list`, `create`, `update` and `delete`
- `status` (`ready | missing | wrong`, plus `keyCreated` and
  `keyFromEnvironment`)

**No endpoint returns a secret's value or the master key.** Anything that
handles the key goes over Electron IPC to the main process, which owns the
keychain: **Copy secrets key**, **Reset secrets** and **Rotate key**. The main
process uses the same store module directly and gives the shim its new key, so
the key never travels over the shim's HTTP port.

**Key in the app:**

- The Electron main process reads the keychain item through `@napi-rs/keyring`,
  pinned exactly. It creates the item, and the file, when the first secret is
  saved.
- It hands the key to the shim at start-up, and to every engine it spawns as
  `ENSO_SECRETS_KEY` through `projectEnvVars`
  (`app/project-manager-shim/src/projectService/index.ts`).
- If `ENSO_SECRETS_KEY` is set in the app's own environment, it wins and the
  keychain is not touched.

**`LocalBackend`:**

- `createSecret`, `updateSecret` and `listSecrets` call the shim.
- `getSecret` returns the name and id only.
- `SecretInfo.path` is `secret://<name>`.
- `parentDirectoryId` is ignored, because the list is flat.

**GUI:**

- **Settings → Local → Secrets**, a new section:
  - a list of names, with **New secret**, **Change value** (through the existing
    `UpsertSecretForm`) and **Delete** (with a confirmation)
  - **Copy secrets key**, behind a warning that whoever has it can read every
    secret
  - **Reset secrets**, shown only when the key is missing or wrong
  - **Rotate key** (below)
- **Datalink editor:** `DatalinkInput.vue` drops `EnsoSecret` from
  `UNAVAILABLE_SCHEMAS`. A secure field becomes **Plain text | Secret**, with a
  picker of local secrets and **New secret…**. `JSONSchemaInput.vue`'s read-only
  `enso-secret` field becomes that picker. Existing plain-text values keep
  working.
- **Graph editor:** for local projects, the file browser's **New Secret**
  (`UpsertSecretPanel`) and the secret picker (`WidgetFileBrowser`'s
  `useTextSecrets`) come back, backed by `listSecrets` / `createSecret`. The
  `localBrowser.ts` assertion against `'secret'` goes.

**Rotating the key** (Settings → Secrets → **Rotate key**):

1. Take the lock and decrypt every value with the current key.
2. Generate a new key and save it as the keychain item `secrets-key-next`.
3. Re-encrypt everything with the new key, then write the file atomically (new
   `keyId`, new `keyCreated`).
4. Replace `secrets-key` with the new key, then delete `secrets-key-next`.

**Recovery:** on start-up, if the file's `keyId` matches `secrets-key-next`
rather than `secrets-key`, the app completes step 4.

**Rotation is unavailable:**

- **while any project is open.** Running engines hold the old key in their
  environment, so the button says "Close open projects to rotate the key".
- **when `ENSO_SECRETS_KEY` is set** in the app's environment. The section says
  "The key is set by ENSO_SECRETS_KEY."

The confirmation warns that servers using a copied key need the new key **and**
the re-encrypted file.

**Age reminders:**

- **Once `keyCreated` is 365 days old:**
  - Settings → Secrets shows "Your secrets key is over a year old" with **Rotate
    now**.
  - On start-up, a toast says the same, with **Rotate** and **Remind me in a
    month**.
- **The snooze:** "Remind me in a month" snoozes the toast for 30 days. The date
  is stored with the other per-user settings (`createPersistedStore`). It
  repeats monthly until the key is rotated.
- **No reminders** when `ENSO_SECRETS_KEY` is set.

### 4. The command line and servers

**Desktop command line** (`enso --run …` where the app created the secrets):

- With no `ENSO_SECRETS_KEY`, the engine reads the keychain item itself, through
  a new JPMS wrapper in `lib/java/` around java-keyring (JNA).
- On macOS, the first read asks once ("enso wants to use your keychain"), and
  again after the `enso` binary changes.
- The engine only reads the keychain; it never creates or changes the item.

**Servers, CI and scheduled runs:**

1. Copy `~/.enso/secrets.json` (or set `ENSO_SECRETS_FILE`).
2. Set `ENSO_SECRETS_KEY` to the copied key.

Secrets are managed there from Enso code (`Enso_Secret.create`, `update_value`,
`delete`). There are no new `enso secrets` subcommands.

**Risk:** JNA inside the engine's native-image launcher. A spike checks it
first. If it fails, desktop command-line use needs `ENSO_SECRETS_KEY` like
servers, and PR 5 is dropped. Nothing else depends on it.

**Documentation:** a user page, `docs/…/local-secrets.md`, linked from
`Enso_Secret`'s documentation. It covers the file, the key, servers, rotation
and a lost key.

## Testing

- **Cross-language fixtures:**
  - `test/fixtures/local-secrets/node-written.json` and `java-written.json`,
    each written once by the other side with a known test key.
  - Node's tests read the Java file and Java's tests read the Node file. This
    pins the format, the associated data and `keyId`.
  - PR 1 adds both, each generated by a small script kept beside it
    (`generate-node.mjs` using Node's `crypto`, `GenerateJava.java`), so the
    Java side is tested against Node-written data before the app's store exists.
- **Stdlib**, in `test/Base_Tests/src/Network/Local_Secrets_Spec.enso`, with
  `ENSO_SECRETS_FILE` and `ENSO_SECRETS_KEY` overridden through
  `Test_Environment`:
  - create, get by bare name and by `secret://`, list, update, delete
  - `Not_Found`, `Locked` and `Wrong_Key`
  - a tampered ciphertext and a renamed entry are rejected
  - an HTTPS header with a secret, against `tools/http-test-helper`
  - plain HTTP is still refused
  - `to_plain_text` is still `Access_Denied`
  - `to_js_object` and `pretty` round trips
  - a datalink with `secretPath: "secret://…"`
- **Java unit tests:** atomic write, the lock (including stale takeover), and
  creating the file on a server with only `ENSO_SECRETS_KEY`.
- **Shim (vitest):** the same store cases, plus rotation interrupted after each
  step and recovered on the next start.
- **Electron (vitest):** key lookup order (environment, keychain, create) with a
  mocked keyring, and `ENSO_SECRETS_KEY` passed to spawned engines.
- **GUI (vitest, Playwright):**
  - Settings → Secrets: create, change, delete, copy key, reset
  - rotation blocked while a project is open
  - the year-old banner and toast, with the monthly snooze
  - the datalink picker and the graph editor's New Secret
- **Manual** (Windows, and WSL for the server flow):
  - a Settings secret used by a workflow's HTTP header and by a datalink
  - rotation
  - `enso --run` reading the keychain
  - the copied file plus `ENSO_SECRETS_KEY` on Linux

## Delivery

**Spike:** java-keyring inside the native-image launcher. Windows and Linux are
checked locally; macOS through a temporary CI job.

Then five PRs. Each works on its own, and features wait for the user's test:

1. **Engine store:** the cross-language fixtures, `LocalSecretStore`,
   `Enso_Secret` `Local`, `secret://`, datalink saving, the errors, and the
   tests. Workflows can use secrets with `ENSO_SECRETS_KEY` set. Changelog: Enso
   Standard Library.
2. **The app's store:**
   - the shim store and endpoints
   - the Electron keychain key, passed to engines
   - `LocalBackend`
   - Settings → Secrets: list, new, change, delete, copy key, reset

   Changelog: Enso IDE.

3. **Secrets in the editors:** the datalink picker and the graph editor's New
   Secret and widget.
4. **Rotation and age reminders.**
5. **The desktop command-line keychain:** the `lib/java` java-keyring wrapper.
   Dropped if the spike fails.

## Out of scope

- Removing Enso Cloud from the stdlib, which is later work. Until then `enso://`
  secrets keep their cloud code path.
- The OAuth credential forms (Google, Strava, MS365, Salesforce, Snowflake
  OAuth).
- Per-folder or per-project secrets.
- `enso secrets` command-line subcommands.
- Syncing secrets between machines, beyond copying the file and the key.
- Reading a secret's value back in the app.
