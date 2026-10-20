/**
 * @file The local secrets master key, as Electron main holds it.
 *
 * Sources, in order: `ENSO_SECRETS_KEY` in the app's own environment (the keychain is then never
 * touched), then the keychain item service `Enso`, account `secrets-key`. The key is created at
 * start-up only when there is nothing to lose: no environment key, no keychain item, and no secrets
 * file with secrets in it. A file with secrets but no key is the `missing` state, and creating a
 * key then would only make it `wrong`.
 *
 * The key never crosses into the renderer: "Copy secrets key" writes it to the clipboard from main.
 *
 * `@napi-rs/keyring` is a native module, loaded on first use ({@link lazyKeyringEntries}) rather
 * than when the bundle loads: if it cannot load, `initialise` fails, start-up logs that and carries
 * on with no key (Settings shows the secrets as locked), instead of the app failing to start.
 */
import { randomBytes } from 'node:crypto'
import { decodeKey, encodeKey, keyId, type LocalSecrets } from 'project-manager-shim/localSecrets'

/** The keychain account of the master key. The service is always `Enso`. */
export const SECRETS_KEY_ACCOUNT = 'secrets-key'
/** The keychain account of a rotation's new key, until the rotation completes. */
export const SECRETS_KEY_NEXT_ACCOUNT = 'secrets-key-next'
/** The environment variable that overrides the keychain. */
export const SECRETS_KEY_VARIABLE = 'ENSO_SECRETS_KEY'

const KEY_BYTES = 32

/**
 * Why `secrets.rotate` and `secrets.reset` refuse while an engine runs. Each engine was started
 * with the key in its environment, and could write under the old key after the file is
 * re-encrypted or deleted. These are the IPC errors' messages; the GUI recognises them with
 * `isSecretsBlockedByProjects` in `app/gui/src/electronApi.ts` (keep the two in step) and shows
 * its own localized text from `english.json`.
 */
export const ROTATE_BLOCKED_BY_PROJECTS = 'Close open projects to rotate the key.'
export const RESET_BLOCKED_BY_PROJECTS = 'Close open projects to reset your secrets.'

/** The slice of `@napi-rs/keyring`'s `Entry` this module uses. */
export interface KeyringEntryLike {
  getPassword(): string | null
  setPassword(password: string): void
  deletePassword(): boolean
}

/** Where {@link SecretsKeySource} looks for the key. */
export interface SecretsKeySourceOptions {
  /**
   * The app's environment (`process.env`). Narrower than `NodeJS.ProcessEnv`, whose index signature
   * here (`globals.d.ts`) admits no object literal, so tests can pass one.
   */
  readonly env: { readonly [SECRETS_KEY_VARIABLE]?: string | undefined }
  /**
   * The keychain entry for an account; the service is always `Enso`. Asynchronous, so the native
   * module behind it can load on first use: see {@link lazyKeyringEntries}.
   */
  readonly entry: (account: string) => Promise<KeyringEntryLike>
  /** The `keyId` the secrets file was written with (from `LocalSecrets`); used by rotation recovery. */
  readonly fileKeyId: () => Promise<string | null>
  /** Whether the secrets file exists and has at least one secret in it. */
  readonly fileHasSecrets: () => Promise<boolean>
}

/** The master key's source: the environment, or the keychain. */
export class SecretsKeySource {
  readonly fromEnvironment: boolean
  readonly #options: SecretsKeySourceOptions
  #key: Buffer | null = null

  /** Read `ENSO_SECRETS_KEY`; an invalid value is reported and leaves the key unset. */
  constructor(options: SecretsKeySourceOptions) {
    this.#options = options
    const fromEnvironment = options.env[SECRETS_KEY_VARIABLE]
    this.fromEnvironment = fromEnvironment != null && fromEnvironment !== ''
    if (this.fromEnvironment) {
      try {
        this.#key = decodeKey(fromEnvironment!)
      } catch (error) {
        console.error(`${SECRETS_KEY_VARIABLE} is set but is not a valid secrets key:`, error)
      }
    }
  }

  /**
   * Called once at start-up (and after a reset): read the keychain key, and create it when there
   * is nothing to lose. Keychain failures propagate, so an unreadable keychain never leads to a key
   * being overwritten.
   */
  async initialise(): Promise<void> {
    if (this.fromEnvironment) return
    const entry = await this.#options.entry(SECRETS_KEY_ACCOUNT)
    const unpromoted = await this.#recoverRotation(entry)
    if (unpromoted != null) {
      // The file is under the pending key, which the keychain would not save as `secrets-key`:
      // use it, and keep the item, so that the next start-up tries again.
      console.error(`Could not promote ${SECRETS_KEY_NEXT_ACCOUNT}; using it for now.`)
      this.#key = unpromoted
      return
    }
    const stored = entry.getPassword()
    if (stored != null && stored !== '') {
      this.#key = decodeKey(stored)
      return
    }
    if (await this.#options.fileHasSecrets()) {
      this.#key = null
      return
    }
    const key = randomBytes(KEY_BYTES)
    entry.setPassword(encodeKey(key))
    this.#key = key
  }

  /**
   * Finish or undo a rotation that stopped part way: see Note [Crash-Safe Key Rotation]. A pending
   * key the file was re-encrypted with replaces `secrets-key`; any other is dropped, because the
   * rotation never reached the file, unless it is the key in use. Reading failures propagate
   * before anything is written.
   * @returns the pending key when it is still needed and could not be promoted (the keychain did
   * not keep it as `secrets-key`, or it is the key in use while the file is not under it); the item
   * is then kept. `null` when no rotation is pending any more.
   */
  async #recoverRotation(entry: KeyringEntryLike): Promise<Buffer | null> {
    const nextEntry = await this.#options.entry(SECRETS_KEY_NEXT_ACCOUNT)
    const next = nextEntry.getPassword()
    if (next == null || next === '') return null
    let nextKey: Buffer | null
    try {
      nextKey = decodeKey(next)
    } catch {
      // Not a key, so not the one the file was written with.
      nextKey = null
    }
    if (nextKey != null && keyId(nextKey) === (await this.#options.fileKeyId())) {
      entry.setPassword(next)
      if (entry.getPassword() !== next) return nextKey
    } else if (nextKey != null && this.#key != null && nextKey.equals(this.#key)) {
      return nextKey
    }
    nextEntry.deletePassword()
    return null
  }

  /**
   * Replace the key with a new one, re-encrypting `store`: see Note [Crash-Safe Key Rotation]. The
   * caller makes sure no engine is running, and that rotations and resets do not overlap (see
   * {@link rotateSecretsKey}).
   */
  async rotate(store: Pick<LocalSecrets, 'rotate' | 'fileKeyId'>): Promise<void> {
    if (this.fromEnvironment) throw new Error(`The key is set by ${SECRETS_KEY_VARIABLE}.`)
    const oldKey = this.#key
    if (oldKey == null) throw new Error('There is no secrets key to rotate.')
    // Note [Settle A Pending Rotation First]
    const entry = await this.#options.entry(SECRETS_KEY_ACCOUNT)
    const nextEntry = await this.#options.entry(SECRETS_KEY_NEXT_ACCOUNT)
    const unpromoted = await this.#recoverRotation(entry)
    const current = this.#key
    if (
      unpromoted != null ||
      current == null ||
      !current.equals(oldKey) ||
      entry.getPassword() !== encodeKey(oldKey) ||
      (nextEntry.getPassword() ?? '') !== ''
    ) {
      throw new Error(
        'The secrets key cannot be rotated now: the keychain does not hold the key in use. ' +
          'Restart Enso and try again.',
      )
    }
    const newKey = randomBytes(KEY_BYTES)
    const encoded = encodeKey(newKey)
    nextEntry.setPassword(encoded)
    if (nextEntry.getPassword() !== encoded) {
      // Nothing has touched the file, so whatever the item holds is worthless.
      nextEntry.deletePassword()
      throw new Error(`The keychain did not keep the new key (${SECRETS_KEY_NEXT_ACCOUNT}).`)
    }
    try {
      // Switch to the new key inside the store's lock, before any write queued behind this one.
      await store.rotate(oldKey, newKey, () => {
        this.#key = newKey
      })
    } catch (error) {
      // Note [A Rotation That Fails After The Rename]
      let fileKeyId: string | null | undefined
      try {
        fileKeyId = await store.fileKeyId()
      } catch {
        fileKeyId = undefined
      }
      if (fileKeyId === keyId(newKey)) {
        console.warn('The secrets file was rotated, but the store then failed:', error)
        this.#key = newKey
      } else {
        if (fileKeyId !== undefined) {
          // The file is still under the old key, so the pending key is worthless.
          this.#key = oldKey
          nextEntry.deletePassword()
        }
        // Otherwise, the file is unknown: keep `-next` for start-up's `#recoverRotation`.
        throw error
      }
    }
    entry.setPassword(encoded)
    if (entry.getPassword() !== encoded) {
      // Keep `-next`: the next start-up promotes it, since the file is under it.
      throw new Error(
        `The keychain did not keep the new key (${SECRETS_KEY_ACCOUNT}); ` +
          'Enso will finish the rotation when it next starts.',
      )
    }
    nextEntry.deletePassword()
  }

  /* Note [Settle A Pending Rotation First]
   * =======================================
   * A failed rotation can leave `-next` as the only item holding the file's key (the `secrets-key`
   * read-back failed, or the file's `keyId` could not be read). Another rotation started then would
   * overwrite `-next` before touching the file, or drop it when that rotation fails. So a rotation
   * first runs start-up's recovery against the current file, and goes ahead only when afterwards
   * `secrets-key` holds the key in use and no `-next` is left; otherwise it refuses. Reset needs no
   * such check: it deletes the file along with both items. */

  /* Note [A Rotation That Fails After The Rename]
   * =============================================
   * `LocalSecrets.rotate` can reject after the file was replaced (say, a cleanup or a filesystem
   * error after the rename). Rolling back then would leave the file under a key no item holds. So a
   * failure is judged by the file, not by the rejection: if its `keyId` is the new key's, the
   * rotation goes on to step 4; if it is any other, `-next` is dropped; if it cannot be read,
   * `-next` stays and the next start-up decides, as for a crash. */

  /* Note [Crash-Safe Key Rotation]
   * ==============================
   * 1. Generate a new key.
   * 2. Save it as the keychain item `secrets-key-next`, and read it back.
   * 3. `LocalSecrets.rotate`: under one hold of the lock, decrypt every value with the old key,
   *    re-encrypt it with the new one, and replace the file atomically with the new `keyId` and
   *    `keyCreated`.
   * 4. Save the new key as `secrets-key`, read it back, then delete `secrets-key-next`.
   *
   * At every point some keychain item opens the file. A crash before 3 leaves the file under the
   * old key, and start-up deletes `-next`. A crash after 3 leaves the file under `-next`'s key, and
   * start-up promotes it (`#recoverRotation`, which compares the file's `keyId`). */

  /** The key, or null; never creates one. */
  current(): Buffer | null {
    return this.#key
  }

  /** The key as unpadded base64url, for "Copy secrets key"; null when there is none. */
  exportKey(): string | null {
    return this.#key == null ? null : encodeKey(this.#key)
  }

  /**
   * Delete the keychain key, and any pending rotation's; the caller deletes the file and then calls
   * {@link initialise}. An environment key is left alone: it is not ours to forget.
   */
  async forget(): Promise<void> {
    if (this.fromEnvironment) return
    const entry = await this.#options.entry(SECRETS_KEY_ACCOUNT)
    entry.deletePassword()
    this.#key = null
    const nextEntry = await this.#options.entry(SECRETS_KEY_NEXT_ACCOUNT)
    nextEntry.deletePassword()
  }
}

/** What the `secrets.rotate` and `secrets.reset` IPC handlers work on. */
export interface SecretsActionOptions {
  readonly keySource: SecretsKeySource
  readonly store: LocalSecrets
  /** Whether any engine is running; see `ProjectService.hasRunningProjects`. */
  readonly hasRunningProjects: () => Promise<boolean>
}

let secretsActionQueue: Promise<unknown> = Promise.resolve()

/**
 * Run `action` after every rotation or reset started before it has settled, so that two IPC calls
 * never interleave their keychain and file steps.
 */
function queued<T>(action: () => Promise<T>): Promise<T> {
  const result = secretsActionQueue.then(action, action)
  secretsActionQueue = result.catch(() => undefined)
  return result
}

/** `secrets.rotate`: rotate the key, unless an engine is running. */
export function rotateSecretsKey(options: SecretsActionOptions): Promise<void> {
  return queued(async () => {
    if (await options.hasRunningProjects()) throw new Error(ROTATE_BLOCKED_BY_PROJECTS)
    await options.keySource.rotate(options.store)
  })
}

/**
 * `secrets.reset`: delete the file and the key, then create a new key, unless an engine is running.
 */
export function resetSecrets(options: SecretsActionOptions): Promise<void> {
  return queued(async () => {
    if (await options.hasRunningProjects()) throw new Error(RESET_BLOCKED_BY_PROJECTS)
    await options.store.reset()
    await options.keySource.forget()
    await options.keySource.initialise()
  })
}

/**
 * A keychain entry factory whose native module is loaded by `load` on the first entry, not before:
 * a module that fails to load then fails that call (which start-up catches and logs), rather than
 * the whole app at start-up. The load is attempted once; a failure is remembered.
 */
export function lazyKeyringEntries(
  load: () => Promise<(account: string) => KeyringEntryLike>,
): (account: string) => Promise<KeyringEntryLike> {
  let factory: Promise<(account: string) => KeyringEntryLike> | undefined
  return async (account) => (await (factory ??= load()))(account)
}
