/** @file The master key's sources in Electron main (`src/secretsKey.ts`), against an in-memory keyring. */
import { randomBytes } from 'node:crypto'
import { decodeKey, encodeKey } from 'project-manager-shim/localSecrets'
import { describe, expect, test } from 'vitest'

import { SecretsKeySource, type KeyringEntryLike } from '../../src/secretsKey'

/** An in-memory keyring keyed by account; the service is always `Enso`. */
class FakeKeyring {
  readonly items = new Map<string, string>()
  readonly accounts: string[] = []

  entry = (account: string): KeyringEntryLike => {
    this.accounts.push(account)
    return {
      getPassword: () => this.items.get(account) ?? null,
      setPassword: (password) => {
        this.items.set(account, password)
      },
      deletePassword: () => this.items.delete(account),
    }
  }
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
      entry: () => {
        throw new Error('The keyring must not be used.')
      },
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
    keySource.forget()
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
      entry: () => {
        throw new Error('The keyring must not be used.')
      },
      fileKeyId: async () => null,
      fileHasSecrets: async () => false,
    })
    keySource.forget()
    expect(keySource.current()).toEqual(key)
  })
})
