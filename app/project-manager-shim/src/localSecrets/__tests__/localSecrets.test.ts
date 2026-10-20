import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readValueForTests } from '../crypto.js'
import {
  decodeKey,
  defaultSecretsFilePath,
  encodeKey,
  keyId,
  LocalSecrets,
  LocalSecretsError,
  SECRET_PATH_PREFIX,
  type SecretsErrorKind,
} from '../index.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..')
const JAVA_FIXTURE = path.join(REPO_ROOT, 'test/fixtures/local-secrets/java-written.json')
const FIXTURE_KEY = decodeKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8')
const OTHER_KEY = Buffer.alloc(32, 7)
const NOW = new Date('2026-10-18T14:02:11.789Z')

let root: string
let file: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-secrets-'))
  file = path.join(root, 'sub', 'secrets.json')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function storeFor(key: Buffer | null, filePath = file, now = NOW) {
  return new LocalSecrets({ filePath, getKey: () => key, now: () => now })
}

async function readFile() {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  )
}

async function expectKind(promise: Promise<unknown>, kind: SecretsErrorKind) {
  const error = await rejection(promise)
  expect(error).toBeInstanceOf(LocalSecretsError)
  expect((error as LocalSecretsError).kind).toBe(kind)
}

describe('the Java-written fixture', () => {
  test('lists the names and reads the values', async () => {
    const store = storeFor(FIXTURE_KEY, JAVA_FIXTURE)
    expect((await store.list()).map((s) => s.name)).toEqual(['alpha', 'unicode-é'])
    expect(await readValueForTests(store, 'alpha')).toBe('first value')
    expect(await readValueForTests(store, 'unicode-é')).toBe('ünïcödé ✓')
  })

  test('another key reads as WRONG_KEY', async () => {
    await expectKind(readValueForTests(storeFor(OTHER_KEY, JAVA_FIXTURE), 'alpha'), 'WRONG_KEY')
  })
})

describe('writing', () => {
  test('create, update and delete round-trip in the documented format', async () => {
    const store = storeFor(FIXTURE_KEY)
    await store.create('one', 'v1')
    const created = await readFile()
    expect(created).toEqual({
      version: 1,
      keyId: keyId(FIXTURE_KEY),
      keyCreated: '2026-10-18T14:02:11Z',
      secrets: {
        one: {
          nonce: expect.stringMatching(/^[A-Za-z0-9+/]{16}$/),
          value: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/),
          created: '2026-10-18T14:02:11Z',
          updated: '2026-10-18T14:02:11Z',
        },
      },
    })
    expect(Object.keys(created)).toEqual(['version', 'keyId', 'keyCreated', 'secrets'])
    expect(Object.keys(created.secrets.one)).toEqual(['nonce', 'value', 'created', 'updated'])
    const text = await fs.readFile(file, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).not.toContain('\r')
    expect(text).toContain('\n  "version": 1,')
    expect(await readValueForTests(store, 'one')).toBe('v1')

    const later = storeFor(FIXTURE_KEY, file, new Date('2026-10-19T00:00:00Z'))
    await later.update('one', 'v2')
    const updated = await readFile()
    expect(updated.secrets.one.created).toBe('2026-10-18T14:02:11Z')
    expect(updated.secrets.one.updated).toBe('2026-10-19T00:00:00Z')
    expect(updated.secrets.one.nonce).not.toBe(created.secrets.one.nonce)
    expect(await readValueForTests(later, 'one')).toBe('v2')
    expect(await later.list()).toEqual([
      { name: 'one', created: '2026-10-18T14:02:11Z', updated: '2026-10-19T00:00:00Z' },
    ])

    await later.delete('one')
    expect(await later.list()).toEqual([])
    expect((await readFile()).secrets).toEqual({})
  })

  test('leaves no lock or temporary file behind', async () => {
    await storeFor(FIXTURE_KEY).create('a', 'b')
    expect((await fs.readdir(path.dirname(file))).sort()).toEqual(['secrets.json'])
  })

  test('unknown fields survive a write', async () => {
    const store = storeFor(FIXTURE_KEY)
    await store.create('a', 'b')
    const json = await readFile()
    json.extra = { keep: true }
    json.secrets.a.note = 'hi'
    await fs.writeFile(file, JSON.stringify(json))
    await store.create('c', 'd')
    const after = await readFile()
    expect(after.extra).toEqual({ keep: true })
    expect(after.secrets.a.note).toBe('hi')
  })

  test('a stale lock is taken over and removed', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const lock = `${file}.lock`
    await fs.writeFile(lock, '')
    const old = new Date(Date.now() - 60_000)
    await fs.utimes(lock, old, old)
    await storeFor(FIXTURE_KEY).create('a', 'b')
    await expect(fs.access(lock)).rejects.toThrow()
    expect((await storeFor(FIXTURE_KEY).list()).map((s) => s.name)).toEqual(['a'])
  })

  test('concurrent writers lose nothing', async () => {
    const stores = [storeFor(FIXTURE_KEY), storeFor(FIXTURE_KEY)]
    await Promise.all(Array.from({ length: 10 }, (_, i) => stores[i % 2]!.create(`s${i}`, 'v')))
    expect(await stores[0]!.list()).toHaveLength(10)
  })
})

describe('errors', () => {
  test('NOT_FOUND on update and delete, with the shared message', async () => {
    const store = storeFor(FIXTURE_KEY)
    await expectKind(store.update('x', 'v'), 'NOT_FOUND')
    await expectKind(store.delete('x'), 'NOT_FOUND')
    await expect(store.delete('x')).rejects.toThrow('Cannot find secret: secret://x')
  })

  test('ALREADY_EXISTS', async () => {
    const store = storeFor(FIXTURE_KEY)
    await store.create('x', 'v')
    await expectKind(store.create('x', 'v'), 'ALREADY_EXISTS')
    await expect(store.create('x', 'v')).rejects.toThrow(
      'A secret with the name "x" already exists.',
    )
  })

  test('LOCKED without a key, on writes', async () => {
    const store = storeFor(null)
    await expectKind(store.create('x', 'v'), 'LOCKED')
    await expect(store.create('x', 'v')).rejects.toThrow(
      'Local secrets are locked: set ENSO_SECRETS_KEY or use Enso on the desktop where they were created.',
    )
  })

  test('list needs neither a key nor a lock', async () => {
    expect((await storeFor(null, JAVA_FIXTURE).list()).map((s) => s.name)).toEqual([
      'alpha',
      'unicode-é',
    ])
    expect(await storeFor(null).list()).toEqual([])
  })

  test('WRONG_KEY on a write with another key', async () => {
    await storeFor(FIXTURE_KEY).create('x', 'v')
    const other = storeFor(OTHER_KEY)
    await expectKind(other.create('y', 'v'), 'WRONG_KEY')
    await expect(other.create('y', 'v')).rejects.toThrow(
      'The local secrets file was created with a different key.',
    )
  })

  test('a file with no secrets under another key adopts the current key on a write', async () => {
    await storeFor(OTHER_KEY).create('a', 'v')
    await storeFor(OTHER_KEY).delete('a')
    const json = await readFile()
    json.futureField = 42
    json.keyCreated = '2020-01-01T00:00:00Z'
    await fs.writeFile(file, JSON.stringify(json))
    const store = storeFor(FIXTURE_KEY)
    expect(await store.status()).toEqual({ state: 'empty' })
    await store.create('b', 'v2')
    const after = await readFile()
    expect(after.keyId).toBe(keyId(FIXTURE_KEY))
    expect(after.keyCreated).toBe('2026-10-18T14:02:11Z')
    expect(after.futureField).toBe(42)
    expect(await readValueForTests(store, 'b')).toBe('v2')
    expect(await store.status()).toEqual({ state: 'ready', keyCreated: '2026-10-18T14:02:11Z' })
  })

  test('a file with secrets under another key stays WRONG_KEY and unchanged', async () => {
    await storeFor(OTHER_KEY).create('a', 'v')
    const before = await fs.readFile(file, 'utf8')
    await expectKind(storeFor(FIXTURE_KEY).delete('a'), 'WRONG_KEY')
    await expectKind(storeFor(FIXTURE_KEY).create('b', 'v'), 'WRONG_KEY')
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  test('a value moved to another name is WRONG_KEY', async () => {
    const store = storeFor(FIXTURE_KEY)
    await store.create('a', 'v')
    const json = await readFile()
    json.secrets.b = json.secrets.a
    await fs.writeFile(file, JSON.stringify(json))
    await expectKind(readValueForTests(store, 'b'), 'WRONG_KEY')
  })

  test('NEWER_VERSION on any read', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ version: 2, secrets: {} }))
    const store = storeFor(FIXTURE_KEY)
    await expectKind(store.list(), 'NEWER_VERSION')
    await expectKind(store.status(), 'NEWER_VERSION')
    await expectKind(store.create('a', 'b'), 'NEWER_VERSION')
  })
})

describe('status', () => {
  test('empty with no file, and with no secrets', async () => {
    expect(await storeFor(FIXTURE_KEY).status()).toEqual({ state: 'empty' })
    expect(await storeFor(null).status()).toEqual({ state: 'empty' })
    await storeFor(FIXTURE_KEY).create('a', 'b')
    await storeFor(FIXTURE_KEY).delete('a')
    expect(await storeFor(FIXTURE_KEY).status()).toEqual({ state: 'empty' })
  })

  test('ready, missing and wrong', async () => {
    await storeFor(FIXTURE_KEY).create('a', 'b')
    expect(await storeFor(FIXTURE_KEY).status()).toEqual({
      state: 'ready',
      keyCreated: '2026-10-18T14:02:11Z',
    })
    expect(await storeFor(null).status()).toEqual({ state: 'missing' })
    expect(await storeFor(OTHER_KEY).status()).toEqual({ state: 'wrong' })
  })

  test('a file without keyCreated gets one on the first status, and keeps it', async () => {
    await storeFor(FIXTURE_KEY).create('a', 'b')
    const json = await readFile()
    delete json.keyCreated
    await fs.writeFile(file, JSON.stringify(json))
    const first = await storeFor(FIXTURE_KEY).status()
    expect(first).toEqual({ state: 'ready', keyCreated: '2026-10-18T14:02:11Z' })
    expect((await readFile()).keyCreated).toBe('2026-10-18T14:02:11Z')
    const later = storeFor(FIXTURE_KEY, file, new Date('2027-01-01T00:00:00Z'))
    expect(await later.status()).toEqual(first)
  })
})

describe('reset and fileKeyId', () => {
  test('fileKeyId reads the id; reset deletes the file', async () => {
    const store = storeFor(FIXTURE_KEY)
    expect(await store.fileKeyId()).toBeNull()
    await store.create('a', 'b')
    expect(await store.fileKeyId()).toBe(keyId(FIXTURE_KEY))
    await store.reset()
    await expect(fs.access(file)).rejects.toThrow()
    await store.reset()
  })
})

describe('paths, keys and names', () => {
  test('defaultSecretsFilePath', () => {
    expect(defaultSecretsFilePath({ ENSO_SECRETS_FILE: '/x' }, '/home')).toBe('/x')
    expect(defaultSecretsFilePath({}, '/home')).toBe(path.join('/home', '.enso', 'secrets.json'))
  })

  test('key encoding', () => {
    expect(encodeKey(FIXTURE_KEY)).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8')
    expect(keyId(FIXTURE_KEY)).toBe('630dcd2966c43366')
    expect(() => decodeKey('AAEC')).toThrow()
    expect(() => decodeKey('!!!')).toThrow()
    expect(SECRET_PATH_PREFIX).toBe('secret://')
  })

  test.each(['', 'a/b', 'connection-x', 'secret://x', 'a'.repeat(201)])(
    'the name %j is rejected with a plain Error',
    async (name) => {
      const store = storeFor(FIXTURE_KEY)
      for (const call of [
        () => store.create(name, 'v'),
        () => store.update(name, 'v'),
        () => store.delete(name),
      ]) {
        const error = await rejection(call())
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toBeInstanceOf(LocalSecretsError)
      }
    },
  )

  test.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'])(
    'the name %s is stored like any other',
    async (name) => {
      const store = storeFor(FIXTURE_KEY)
      await expectKind(readValueForTests(store, name), 'NOT_FOUND')
      await expectKind(store.update(name, 'x'), 'NOT_FOUND')
      await expectKind(store.delete(name), 'NOT_FOUND')
      await store.create('plain', 'p')
      await store.create(name, 'v1')
      expect((await store.list()).map((s) => s.name)).toEqual([name, 'plain'].sort())
      expect(Object.keys((await readFile()).secrets)).toContain(name)
      expect(await readValueForTests(store, name)).toBe('v1')
      await expectKind(store.create(name, 'again'), 'ALREADY_EXISTS')
      await store.update(name, 'v2')
      expect(await readValueForTests(store, name)).toBe('v2')
      expect(await readValueForTests(store, 'plain')).toBe('p')
      expect(Object.getPrototypeOf((await readFile()).secrets)).toBe(Object.prototype)
      await store.delete(name)
      expect((await store.list()).map((s) => s.name)).toEqual(['plain'])
    },
  )

  test('a 200-character name is accepted', async () => {
    await storeFor(FIXTURE_KEY).create('a'.repeat(200), 'v')
  })
})
