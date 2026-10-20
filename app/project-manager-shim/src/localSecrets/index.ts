/**
 * The local secrets file: an encrypted `secrets.json` shared with the engine's Java store
 * (`LocalSecretStore`), which this mirrors byte for byte.
 *
 * Format: `{"version": 1, "keyId", "keyCreated", "secrets": {name: {"nonce", "value", "created",
 * "updated"}}}`. Values are AES-256-GCM encrypted with the secret name as the AAD. This class never
 * returns a decrypted value: the app only lists, creates, updates and deletes.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errorCode, isRecord, renameWithRetry, serialised } from '../localMetadata/jsonFile.js'
import { decodeKey, decrypt, encodeKey, encrypt, keyId, registerTestReader } from './crypto.js'

export { decodeKey, encodeKey, keyId }

/** The prefix of a secret's path in Enso. */
export const SECRET_PATH_PREFIX = 'secret://'

const VERSION = 1
const STALE_LOCK_MILLIS = 30_000
const LOCK_RETRY_MILLIS = 50
const LOCK_TIMEOUT_MILLIS = 10_000
const MAX_NAME_LENGTH = 200

export type SecretsErrorKind =
  'NOT_FOUND' | 'LOCKED' | 'WRONG_KEY' | 'ALREADY_EXISTS' | 'NEWER_VERSION'

/** A failure with a kind shared with the Java store. */
export class LocalSecretsError extends Error {
  /**
   *
   */
  constructor(
    readonly kind: SecretsErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'LocalSecretsError'
  }
}

/** The error for a store with no key. */
const locked = () =>
  new LocalSecretsError(
    'LOCKED',
    'Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop where they were created.',
  )
/** The error for a file or value made with another key. */
const wrongKey = () =>
  new LocalSecretsError('WRONG_KEY', 'The local secrets file was created with a different key.')
/** The error for a missing secret. */
const notFound = (name: string) =>
  new LocalSecretsError('NOT_FOUND', `Cannot find secret: ${SECRET_PATH_PREFIX}${name}`)

export interface LocalSecretSummary {
  readonly name: string
  readonly created: string
  readonly updated: string
}

export type LocalSecretsStatus =
  /** No file, or no secrets. */
  | { readonly state: 'empty' }
  | { readonly state: 'ready'; readonly keyCreated: string }
  /** Secrets, but no key. */
  | { readonly state: 'missing' }
  /**
   * No key, because the keychain could not be read (locked, or its module failed to load). Not the
   * same as `missing`: the key may well be there, so nothing may be reset.
   */
  | { readonly state: 'unavailable' }
  /** Secrets under another key. */
  | { readonly state: 'wrong' }

export interface LocalSecretsOptions {
  readonly filePath: string
  readonly getKey: () => Buffer | null
  /** Whether the key's source (the keychain) could not be read; `status()` then says so. */
  readonly isKeyUnavailable?: () => boolean
  readonly now?: () => Date
}

type Json = Record<string, unknown>

/** `ENSO_SECRETS_FILE`, or `<home>/.enso/secrets.json`. */
export function defaultSecretsFilePath(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.ENSO_SECRETS_FILE
  return override != null && override !== '' ? override : path.join(home, '.enso', 'secrets.json')
}

/**
 * Check a secret name.
 * @throws {Error} (not a {@link LocalSecretsError}) when the name is not allowed.
 */
function validateName(name: string): void {
  if (name === '') throw new Error('A secret name cannot be empty.')
  if (name.includes('/')) throw new Error('A secret name cannot contain "/".')
  if (name.startsWith('connection-'))
    throw new Error('A secret name cannot start with "connection-".')
  if (name.startsWith(SECRET_PATH_PREFIX)) {
    throw new Error(`A secret name cannot start with "${SECRET_PATH_PREFIX}".`)
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`A secret name cannot be longer than ${MAX_NAME_LENGTH} characters.`)
  }
}

/** The timestamp format of the file: ISO-8601 UTC with seconds. */
function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z')
}

function secretsOf(root: Json): Json {
  if (!isRecord(root.secrets)) setOwn(root, 'secrets', {})
  return root.secrets as Json
}

/**
 * Set `object[key]` as an own, enumerable property. A plain assignment to `__proto__` would call
 * `Object.prototype`'s setter instead, so a secret with that name would silently not be stored.
 * `JSON.parse` already defines such keys as own properties, and `JSON.stringify` writes them back.
 */
function setOwn(object: Json, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/** `object[key]` when it is an own property, so that `__proto__` or `constructor` read as absent. */
function getOwn(object: Json, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined
}

/** The encrypted local secrets file. */
export class LocalSecrets {
  readonly #filePath: string
  readonly #getKey: () => Buffer | null
  readonly #isKeyUnavailable: () => boolean
  readonly #now: () => Date

  /**
   *
   */
  constructor(options: LocalSecretsOptions) {
    this.#filePath = options.filePath
    this.#getKey = options.getKey
    this.#isKeyUnavailable = options.isKeyUnavailable ?? (() => false)
    this.#now = options.now ?? (() => new Date())
    registerTestReader(this, (name) => this.#readValue(name))
  }

  /** The secrets' names and times. Needs neither the key nor the lock. */
  async list(): Promise<readonly LocalSecretSummary[]> {
    const root = await this.#readRoot()
    if (root == null) return []
    const secrets = secretsOf(root)
    return Object.keys(secrets)
      .sort()
      .map((name) => {
        const value = getOwn(secrets, name)
        const entry = isRecord(value) ? value : {}
        return { name, created: String(entry.created ?? ''), updated: String(entry.updated ?? '') }
      })
  }

  /** Add a secret, failing with `ALREADY_EXISTS`, `LOCKED` or `WRONG_KEY`. */
  async create(name: string, value: string): Promise<void> {
    validateName(name)
    await this.#write((key, root, now) => {
      const secrets = secretsOf(root)
      if (Object.hasOwn(secrets, name)) {
        throw new LocalSecretsError(
          'ALREADY_EXISTS',
          `A secret with the name "${name}" already exists.`,
        )
      }
      setOwn(secrets, name, { ...encrypt(key, name, value), created: now, updated: now })
    })
  }

  /** Replace a secret's value, keeping its creation time. */
  async update(name: string, value: string): Promise<void> {
    validateName(name)
    await this.#write((key, root, now) => {
      const secrets = secretsOf(root)
      const old = getOwn(secrets, name)
      if (!isRecord(old)) throw notFound(name)
      setOwn(secrets, name, {
        ...encrypt(key, name, value),
        created: typeof old.created === 'string' ? old.created : now,
        updated: now,
      })
    })
  }

  /** Remove a secret. */
  async delete(name: string): Promise<void> {
    validateName(name)
    await this.#write((_key, root) => {
      const secrets = secretsOf(root)
      if (!Object.hasOwn(secrets, name)) throw notFound(name)
      delete secrets[name]
    })
  }

  /**
   * How the secrets and the key relate. A file without `keyCreated` (one an engine on a server
   * wrote) gets one now, so the key's age counts from the first time the app saw it.
   */
  async status(): Promise<LocalSecretsStatus> {
    if (this.#getKey() == null && this.#isKeyUnavailable()) return { state: 'unavailable' }
    const root = await this.#readRoot()
    if (root == null || Object.keys(secretsOf(root)).length === 0) return { state: 'empty' }
    const key = this.#getKey()
    if (key == null) return { state: 'missing' }
    if (keyId(key) !== root.keyId) return { state: 'wrong' }
    if (typeof root.keyCreated === 'string') return { state: 'ready', keyCreated: root.keyCreated }
    const keyCreated = await this.#withLock(async () => {
      const current = await this.#readRoot()
      if (current == null) return null
      if (typeof current.keyCreated === 'string') return current.keyCreated
      const created = timestamp(this.#now())
      // Keep `keyCreated` after `keyId`, as the other writers lay the file out.
      const reordered: Json = {}
      for (const [k, v] of Object.entries(current)) {
        setOwn(reordered, k, v)
        if (k === 'keyId') reordered.keyCreated = created
      }
      if (!('keyCreated' in reordered)) reordered.keyCreated = created
      await this.#writeRoot(reordered)
      return created
    })
    return keyCreated == null ? { state: 'empty' } : { state: 'ready', keyCreated }
  }

  /** Delete the file. Only Electron main calls this (never over HTTP). */
  async reset(): Promise<void> {
    await this.#withLock(() => fs.rm(this.#filePath, { force: true }))
  }

  /** The `keyId` the file was written with, or `null` when there is no file. */
  async fileKeyId(): Promise<string | null> {
    const root = await this.#readRoot()
    return root != null && typeof root.keyId === 'string' ? root.keyId : null
  }

  async #readValue(name: string): Promise<string> {
    const key = this.#getKey()
    if (key == null) throw locked()
    const root = await this.#readRoot()
    const entry = root == null ? undefined : getOwn(secretsOf(root), name)
    if (root == null || !isRecord(entry)) throw notFound(name)
    if (keyId(key) !== root.keyId) throw wrongKey()
    try {
      return decrypt(key, name, { nonce: String(entry.nonce), value: String(entry.value) })
    } catch {
      throw wrongKey()
    }
  }

  /** Read the file as parsed, or `null` when it does not exist. Refuses a newer version. */
  async #readRoot(): Promise<Json | null> {
    let text: string
    try {
      text = await fs.readFile(this.#filePath, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw error
    }
    const root: unknown = JSON.parse(text)
    if (!isRecord(root)) throw new Error('The local secrets file is not a JSON object.')
    if (typeof root.version === 'number' && root.version > VERSION) {
      throw new LocalSecretsError(
        'NEWER_VERSION',
        'The local secrets file was written by a newer version of Enso.',
      )
    }
    return root
  }

  async #write(mutate: (key: Buffer, root: Json, now: string) => void): Promise<void> {
    const key = this.#getKey()
    if (key == null) throw locked()
    await this.#withLock(async () => {
      const now = timestamp(this.#now())
      let root = await this.#readRoot()
      if (root == null) {
        root = { version: VERSION, keyId: keyId(key), keyCreated: now, secrets: {} }
      } else if (keyId(key) !== root.keyId) {
        // Note [An Empty File Adopts The Current Key]
        if (Object.keys(secretsOf(root)).length !== 0) throw wrongKey()
        root.keyId = keyId(key)
        root.keyCreated = now
      }
      mutate(key, root, now)
      await this.#writeRoot(root)
    })
  }

  /* Note [An Empty File Adopts The Current Key]
   * ===========================================
   * A file with no secrets holds nothing the old key could decrypt, and `status()` reports it as
   * `empty`. If its `keyId` is foreign (say the keychain item was lost and the app made a new key),
   * the next write takes the current key, rewriting `keyId` and `keyCreated`, rather than failing
   * every save with `WRONG_KEY`. With one secret or more, a mismatch stays `WRONG_KEY`. The Java
   * `LocalSecretStore` does the same. */

  async #writeRoot(root: Json): Promise<void> {
    const temporaryPath = `${this.#filePath}.tmp`
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(root, null, 2) + '\n')
      await renameWithRetry(temporaryPath, this.#filePath)
    } finally {
      await fs.rm(temporaryPath, { force: true })
    }
  }

  /** Run `action` holding both the in-process queue and the cross-process lock file. */
  #withLock<T>(action: () => Promise<T>): Promise<T> {
    const lockPath = `${this.#filePath}.lock`
    return serialised(this.#filePath, async () => {
      await fs.mkdir(path.dirname(path.resolve(this.#filePath)), { recursive: true })
      const deadline = Date.now() + LOCK_TIMEOUT_MILLIS
      for (;;) {
        try {
          await (await fs.open(lockPath, 'wx')).close()
          break
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error
          try {
            const age = Date.now() - (await fs.stat(lockPath)).mtimeMs
            if (age > STALE_LOCK_MILLIS) {
              await fs.rm(lockPath, { force: true })
              continue
            }
          } catch (gone) {
            if (errorCode(gone) === 'ENOENT') continue
            throw gone
          }
          if (Date.now() > deadline)
            throw new Error(`Timed out waiting for ${lockPath}`, { cause: error })
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MILLIS))
        }
      }
      try {
        return await action()
      } finally {
        await fs.rm(lockPath, { force: true })
      }
    })
  }
}
