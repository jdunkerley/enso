/** @file The master key's sources in Electron main (`src/secretsKey.ts`), against an in-memory keyring. */
import { randomBytes } from 'node:crypto'
import { decodeKey, encodeKey } from 'project-manager-shim/localSecrets'
import { describe, expect, test, vi } from 'vitest'

import {
  lazyKeyringEntries,
  RESET_BLOCKED_BY_KEYCHAIN,
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

  test('a keychain that could not be read is unavailable, and forget() refuses', async () => {
    const keyring = new FakeKeyring()
    keyring.items.set('secrets-key', encodeKey(randomBytes(32)))
    const realGetPassword = keyring.getPassword
    keyring.getPassword = () => {
      throw new Error('The keychain is locked.')
    }
    const keySource = source(keyring, { fileHasSecrets: true })
    expect(keySource.keychainUnavailable).toBe(false)
    await expect(keySource.initialise()).rejects.toThrow('The keychain is locked.')
    expect(keySource.keychainUnavailable).toBe(true)
    expect(() => keySource.assertKeychainReadable()).toThrow(RESET_BLOCKED_BY_KEYCHAIN)
    await expect(keySource.forget()).rejects.toThrow(RESET_BLOCKED_BY_KEYCHAIN)
    // The item nobody could read is still there.
    expect(keyring.items.has('secrets-key')).toBe(true)
    // Once the keychain can be read again, so can the key, and the state clears.
    keyring.getPassword = realGetPassword
    await keySource.initialise()
    expect(keySource.keychainUnavailable).toBe(false)
    expect(keySource.current()).not.toBeNull()
    expect(() => keySource.assertKeychainReadable()).not.toThrow()
  })

  test('a keychain that reads but has no key is not unavailable', async () => {
    const keyring = new FakeKeyring()
    const keySource = source(keyring, { fileHasSecrets: true })
    await keySource.initialise()
    expect(keySource.current()).toBeNull()
    expect(keySource.keychainUnavailable).toBe(false)
    expect(() => keySource.assertKeychainReadable()).not.toThrow()
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
    expect(keyring.accounts).toEqual(['secrets-key', 'secrets-key'])
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
    expect(keySource.keychainUnavailable).toBe(true)
    await expect(keySource.initialise()).rejects.toThrow('Cannot find module')
    expect(load).toHaveBeenCalledTimes(1)
  })
})
