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
import { decodeKey, encodeKey } from 'project-manager-shim/localSecrets'

/** The keychain account of the master key. The service is always `Enso`. */
export const SECRETS_KEY_ACCOUNT = 'secrets-key'
/** The environment variable that overrides the keychain. */
export const SECRETS_KEY_VARIABLE = 'ENSO_SECRETS_KEY'

const KEY_BYTES = 32

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

  /** The key, or null; never creates one. */
  current(): Buffer | null {
    return this.#key
  }

  /** The key as unpadded base64url, for "Copy secrets key"; null when there is none. */
  exportKey(): string | null {
    return this.#key == null ? null : encodeKey(this.#key)
  }

  /**
   * Delete the keychain key; the caller deletes the file and then calls {@link initialise}. An
   * environment key is left alone: it is not ours to forget.
   */
  async forget(): Promise<void> {
    if (this.fromEnvironment) return
    const entry = await this.#options.entry(SECRETS_KEY_ACCOUNT)
    entry.deletePassword()
    this.#key = null
  }
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
