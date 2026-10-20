/** @file The master key's sources in Electron main (`src/secretsKey.ts`), against an in-memory keyring. */
import { createDecipheriv, randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { decodeKey, encodeKey, keyId, LocalSecrets } from 'project-manager-shim/localSecrets'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  lazyKeyringEntries,
  resetSecrets,
  rotateSecretsKey,
  SecretsKeySource,
  type KeyringEntryLike,
} from '../../src/secretsKey'

/** An in-memory keyring keyed by account; the service is always `Enso`. */
class FakeKeyring {
  readonly items = new Map<string, string>()
  readonly accounts: string[] = []
  readonly setPassword = vi.fn((account: string, password: string) => {
    this.items.set(account, password)
  })
  getPassword: (account: string) => string | null = (account) => this.items.get(account) ?? null

  entry = async (account: string): Promise<KeyringEntryLike> => this.syncEntry(account)

  /** What `@napi-rs/keyring`'s `new Entry(...)` gives once loaded. */
  syncEntry = (account: string): KeyringEntryLike => {
    this.accounts.push(account)
    return {
      getPassword: () => this.getPassword(account),
      setPassword: (password) => this.setPassword(account, password),
      deletePassword: () => this.items.delete(account),
    }
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  )
}

function source(
  keyring: FakeKeyring,
  options: {
    env?: { ENSO_SECRETS_KEY?: string }
    fileHasSecrets?: boolean
    fileKeyId?: string | null
  } = {},
) {
  return new SecretsKeySource({
    env: options.env ?? {},
    entry: keyring.entry,
    fileKeyId: async () => options.fileKeyId ?? null,
    fileHasSecrets: async () => options.fileHasSecrets ?? false,
  })
}

describe('SecretsKeySource', () => {
  test('ENSO_SECRETS_KEY wins and the keyring is never touched', async () => {
    const key = randomBytes(32)
    const keySource = new SecretsKeySource({
      env: { ENSO_SECRETS_KEY: encodeKey(key) },
      entry: () => Promise.reject(new Error('The keyring must not be used.')),
      fileKeyId: async () => null,
      fileHasSecrets: async () => true,
    })
    expect(keySource.fromEnvironment).toBe(true)
    await keySource.initialise()
    expect(keySource.current()).toEqual(key)
  })

  test('creates a 32-byte key when there is no item and no file', async () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring)
    expect(keySource.fromEnvironment).toBe(false)
    await keySource.initialise()
    const stored = keyring.items.get('secrets-key')
    expect(stored).toBeDefined()
    expect(decodeKey(stored!)).toHaveLength(32)
    expect(keySource.current()).toEqual(decodeKey(stored!))
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
  })

  test('creates nothing when a file with secrets exists but no key does', async () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring, { fileHasSecrets: true, fileKeyId: '0123456789abcdef' })
    await keySource.initialise()
    expect(keyring.items.size).toBe(0)
    expect(keySource.current()).toBeNull()
    expect(keySource.exportKey()).toBeNull()
  })

  test('reuses an existing item', async () => {
    const keyring = new FakeKeyring()
    const key = randomBytes(32)
    keyring.items.set('secrets-key', encodeKey(key))
    const keySource = source(keyring, { fileHasSecrets: true })
    await keySource.initialise()
    expect(keySource.current()).toEqual(key)
    expect(keyring.items.get('secrets-key')).toBe(encodeKey(key))
  })

  test('current() never creates a key', () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring)
    expect(keySource.current()).toBeNull()
    expect(keyring.items.size).toBe(0)
  })

  test('exportKey() round-trips through decodeKey', async () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring)
    await keySource.initialise()
    const exported = keySource.exportKey()
    expect(exported).not.toBeNull()
    expect(exported).not.toContain('=')
    expect(decodeKey(exported!)).toEqual(keySource.current())
  })

  test('forget() deletes the item, and initialise() then creates a new key', async () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring)
    await keySource.initialise()
    const first = keySource.current()
    await keySource.forget()
    expect(keyring.items.has('secrets-key')).toBe(false)
    expect(keySource.current()).toBeNull()
    await keySource.initialise()
    expect(keySource.current()).not.toBeNull()
    expect(keySource.current()).not.toEqual(first)
  })

  test('forget() leaves an environment key alone', async () => {
    const key = randomBytes(32)
    const keySource = new SecretsKeySource({
      env: { ENSO_SECRETS_KEY: encodeKey(key) },
      entry: () => Promise.reject(new Error('The keyring must not be used.')),
      fileKeyId: async () => null,
      fileHasSecrets: async () => false,
    })
    await keySource.forget()
    expect(keySource.current()).toEqual(key)
  })

  test('a keychain that throws on read is never written to', async () => {
    const keyring = new FakeKeyring()
    keyring.getPassword = () => {
      throw new Error('The keychain is locked.')
    }
    const keySource = source(keyring)
    await expect(keySource.initialise()).rejects.toThrow('The keychain is locked.')
    expect(keyring.setPassword).not.toHaveBeenCalled()
    expect(keySource.current()).toBeNull()
  })

  test.each([
    ['not base64url', 'not a key!'],
    ['the wrong length', encodeKey(randomBytes(16))],
  ])('a stored item that is %s is never overwritten', async (_, stored) => {
    const keyring = new FakeKeyring()
    keyring.items.set('secrets-key', stored)
    const keySource = source(keyring)
    const error = await rejection(keySource.initialise())
    expect(error).toBeInstanceOf(Error)
    // The message start-up logs must not carry the item.
    expect(String(error)).not.toContain(stored)
    expect(keyring.setPassword).not.toHaveBeenCalled()
    expect(keyring.items.get('secrets-key')).toBe(stored)
    expect(keySource.current()).toBeNull()
  })
})

describe('lazyKeyringEntries', () => {
  test('loads the native module on the first entry, once', async () => {
    const keyring = new FakeKeyring()
    const load = vi.fn(async () => keyring.syncEntry)
    const entries = lazyKeyringEntries(load)
    expect(load).not.toHaveBeenCalled()
    const keySource = new SecretsKeySource({
      env: {},
      entry: entries,
      fileKeyId: async () => null,
      fileHasSecrets: async () => false,
    })
    expect(load).not.toHaveBeenCalled()
    await keySource.initialise()
    await keySource.forget()
    expect(load).toHaveBeenCalledTimes(1)
    // `initialise` also looks for a pending rotation, and `forget` deletes both items.
    expect(keyring.accounts).toEqual([
      'secrets-key',
      'secrets-key-next',
      'secrets-key',
      'secrets-key-next',
    ])
  })

  test('is never loaded when ENSO_SECRETS_KEY is set', async () => {
    const load = vi.fn(() => Promise.reject(new Error('must not load')))
    const keySource = new SecretsKeySource({
      env: { ENSO_SECRETS_KEY: encodeKey(randomBytes(32)) },
      entry: lazyKeyringEntries(load),
      fileKeyId: async () => null,
      fileHasSecrets: async () => false,
    })
    await keySource.initialise()
    await keySource.forget()
    expect(load).not.toHaveBeenCalled()
  })

  test('a module that fails to load leaves no key, and is not retried', async () => {
    const load = vi.fn(() =>
      Promise.reject(new Error('Cannot find module keyring.win32-x64-msvc.node')),
    )
    const keySource = new SecretsKeySource({
      env: {},
      entry: lazyKeyringEntries(load),
      fileKeyId: async () => null,
      fileHasSecrets: async () => false,
    })
    await expect(keySource.initialise()).rejects.toThrow('Cannot find module')
    expect(keySource.current()).toBeNull()
    expect(keySource.exportKey()).toBeNull()
    await expect(keySource.initialise()).rejects.toThrow('Cannot find module')
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('rotation', () => {
  let root: string
  let file: string
  let keyring: FakeKeyring
  let keySource: SecretsKeySource
  let store: LocalSecrets

  /** A key source over the shared keyring and file, as a fresh start of the app makes. */
  function newSource(): SecretsKeySource {
    return new SecretsKeySource({
      env: {},
      entry: keyring.entry,
      fileKeyId: () => store.fileKeyId(),
      fileHasSecrets: async () => (await store.list()).length > 0,
    })
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-rotation-'))
    file = path.join(root, 'secrets.json')
    keyring = new FakeKeyring()
    store = new LocalSecrets({ filePath: file, getKey: () => keySource.current() })
    keySource = newSource()
    await keySource.initialise()
    await store.create('a', 'first')
    await store.create('b', 'second')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  /** Decrypt a value straight from the file, independently of the store. */
  async function readWith(key: Buffer, name: string): Promise<string> {
    const json = JSON.parse(await fs.readFile(file, 'utf8'))
    const entry = json.secrets[name]
    const body = Buffer.from(entry.value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.nonce, 'base64'))
    decipher.setAAD(Buffer.from(name, 'utf8'))
    decipher.setAuthTag(body.subarray(body.length - 16))
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - 16)),
      decipher.final(),
    ]).toString('utf8')
  }

  async function expectReadable(key: Buffer) {
    expect(await store.fileKeyId()).toBe(keyId(key))
    expect(await readWith(key, 'a')).toBe('first')
    expect(await readWith(key, 'b')).toBe('second')
  }

  /** A fresh start of the app, over the same keyring and file. */
  async function restart(): Promise<SecretsKeySource> {
    keySource = newSource()
    await keySource.initialise()
    return keySource
  }

  test('a full rotation leaves one keychain item and a readable file', async () => {
    const oldKey = keySource.current()!
    await keySource.rotate(store)
    const newKey = keySource.current()!
    expect(newKey).not.toEqual(oldKey)
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
    expect(decodeKey(keyring.items.get('secrets-key')!)).toEqual(newKey)
    await expectReadable(newKey)
    await expect(readWith(oldKey, 'a')).rejects.toThrow()
    // The pending item is written before the file, and the main item after it.
    expect(keyring.setPassword.mock.calls.map(([account]) => account)).toEqual([
      'secrets-key',
      'secrets-key-next',
      'secrets-key',
    ])
    expect((await store.status()).state).toBe('ready')
    // A restart finds nothing to recover.
    expect((await restart()).current()).toEqual(newKey)
  })

  test('crash after step 2: start-up deletes the pending item and keeps the old key', async () => {
    const oldKey = keySource.current()!
    keyring.items.set('secrets-key-next', encodeKey(randomBytes(32)))
    const restarted = await restart()
    expect(restarted.current()).toEqual(oldKey)
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
    expect(keyring.items.get('secrets-key')).toBe(encodeKey(oldKey))
    await expectReadable(oldKey)
  })

  test('crash after step 3: start-up promotes the pending item, and values read', async () => {
    const oldKey = keySource.current()!
    const newKey = randomBytes(32)
    keyring.items.set('secrets-key-next', encodeKey(newKey))
    await store.rotate(oldKey, newKey)
    const restarted = await restart()
    expect(restarted.current()).toEqual(newKey)
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
    expect(keyring.items.get('secrets-key')).toBe(encodeKey(newKey))
    await expectReadable(newKey)
    expect((await store.status()).state).toBe('ready')
  })

  test('an unreadable pending item is deleted, and never replaces the key', async () => {
    const oldKey = keySource.current()!
    keyring.items.set('secrets-key-next', 'not a key!')
    expect((await restart()).current()).toEqual(oldKey)
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
  })

  test('a keychain that throws on reading the pending item is never written to', async () => {
    keyring.items.set('secrets-key-next', encodeKey(randomBytes(32)))
    keyring.setPassword.mockClear()
    keyring.getPassword = () => {
      throw new Error('The keychain is locked.')
    }
    await expect(newSource().initialise()).rejects.toThrow('The keychain is locked.')
    expect(keyring.setPassword).not.toHaveBeenCalled()
    expect(keyring.items.has('secrets-key-next')).toBe(true)
  })

  test('a failed re-encryption deletes the pending item and keeps the old key', async () => {
    const oldKey = keySource.current()!
    // Put the file under another key, so that the store refuses with WRONG_KEY.
    await store.reset()
    const other = new LocalSecrets({ filePath: file, getKey: () => Buffer.alloc(32, 7) })
    await other.create('c', 'v')
    const before = await fs.readFile(file, 'utf8')
    await expect(keySource.rotate(store)).rejects.toThrow(
      'The local secrets file was created with a different key.',
    )
    expect(keySource.current()).toEqual(oldKey)
    expect([...keyring.items.keys()]).toEqual(['secrets-key'])
    expect(keyring.items.get('secrets-key')).toBe(encodeKey(oldKey))
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  test('with ENSO_SECRETS_KEY, rotate throws and touches nothing', async () => {
    const envSource = new SecretsKeySource({
      env: { ENSO_SECRETS_KEY: encodeKey(randomBytes(32)) },
      entry: () => Promise.reject(new Error('The keyring must not be used.')),
      fileKeyId: async () => null,
      fileHasSecrets: async () => true,
    })
    const before = await fs.readFile(file, 'utf8')
    await expect(envSource.rotate(store)).rejects.toThrow('The key is set by ENSO_SECRETS_KEY.')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  test('with no key, rotate throws and touches nothing', async () => {
    const empty = new FakeKeyring()
    const locked = new SecretsKeySource({
      env: {},
      entry: empty.entry,
      fileKeyId: () => store.fileKeyId(),
      fileHasSecrets: async () => true,
    })
    await locked.initialise()
    const before = await fs.readFile(file, 'utf8')
    await expect(locked.rotate(store)).rejects.toThrow('There is no secrets key to rotate.')
    expect(empty.items.size).toBe(0)
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  test('forget() also deletes a pending item', async () => {
    keyring.items.set('secrets-key-next', encodeKey(randomBytes(32)))
    await keySource.forget()
    expect(keyring.items.size).toBe(0)
  })

  describe('while a project is running', () => {
    test('rotateSecretsKey refuses, and changes nothing', async () => {
      const oldKey = keySource.current()!
      const before = await fs.readFile(file, 'utf8')
      await expect(
        rotateSecretsKey({ keySource, store, hasRunningProjects: async () => true }),
      ).rejects.toThrow('Close open projects to rotate the key.')
      expect(keySource.current()).toEqual(oldKey)
      expect([...keyring.items.keys()]).toEqual(['secrets-key'])
      expect(await fs.readFile(file, 'utf8')).toBe(before)
    })

    test('resetSecrets refuses, and changes nothing', async () => {
      const oldKey = keySource.current()!
      const before = await fs.readFile(file, 'utf8')
      await expect(
        resetSecrets({ keySource, store, hasRunningProjects: async () => true }),
      ).rejects.toThrow('Close open projects to reset your secrets.')
      expect(keySource.current()).toEqual(oldKey)
      expect([...keyring.items.keys()]).toEqual(['secrets-key'])
      expect(await fs.readFile(file, 'utf8')).toBe(before)
    })
  })

  describe('with no project running', () => {
    test('rotateSecretsKey rotates', async () => {
      const oldKey = keySource.current()!
      await rotateSecretsKey({ keySource, store, hasRunningProjects: async () => false })
      expect(keySource.current()).not.toEqual(oldKey)
      await expectReadable(keySource.current()!)
    })

    test('resetSecrets deletes the file and the key, then creates a new key', async () => {
      const oldKey = keySource.current()!
      await resetSecrets({ keySource, store, hasRunningProjects: async () => false })
      await expect(fs.access(file)).rejects.toThrow()
      expect(keySource.current()).not.toBeNull()
      expect(keySource.current()).not.toEqual(oldKey)
      expect([...keyring.items.keys()]).toEqual(['secrets-key'])
    })
  })
})
