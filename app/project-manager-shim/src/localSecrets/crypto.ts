/** @file The cryptography of the local secrets file, compatible with the Java store. */
import * as crypto from 'node:crypto'

const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** An encrypted value as stored in the file. */
export interface EncryptedEntry {
  /** Standard base64 with padding. */
  readonly nonce: string
  /** Standard base64 with padding: the ciphertext followed by the 16-byte tag. */
  readonly value: string
}

/** Encrypt `value` with AES-256-GCM, a fresh nonce, and the secret `name` as the AAD. */
export function encrypt(key: Buffer, name: string, value: string): EncryptedEntry {
  const nonce = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(name, 'utf8'))
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { nonce: nonce.toString('base64'), value: body.toString('base64') }
}

/**
 * Decrypt a stored entry.
 * @throws {Error} when the key or the name is not the one the value was encrypted with.
 */
export function decrypt(key: Buffer, name: string, entry: EncryptedEntry): string {
  const nonce = Buffer.from(entry.nonce, 'base64')
  const body = Buffer.from(entry.value, 'base64')
  if (body.length < TAG_BYTES) throw new Error('The encrypted value is too short.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAAD(Buffer.from(name, 'utf8'))
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
  return Buffer.concat([
    decipher.update(body.subarray(0, body.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8')
}

/** The lowercase hex of the first 8 bytes of SHA-256(key). */
export function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest().subarray(0, 8).toString('hex')
}

/** The key as unpadded base64url. */
export function encodeKey(key: Buffer): string {
  return key.toString('base64url')
}

/**
 * Parse an unpadded (or padded) base64url key.
 * @throws {Error} when it is not valid base64url or not 32 bytes.
 */
export function decodeKey(text: string): Buffer {
  const trimmed = text.trim()
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(trimmed)) {
    throw new Error('The secrets key is not valid base64url.')
  }
  const bytes = Buffer.from(trimmed, 'base64url')
  if (bytes.length !== KEY_BYTES) throw new Error('The secrets key must be 32 bytes.')
  return bytes
}

const testReaders = new WeakMap<object, (name: string) => Promise<string>>()

/** Called by the store's constructor so tests can decrypt; nothing else uses it. */
export function registerTestReader(store: object, read: (name: string) => Promise<string>): void {
  testReaders.set(store, read)
}

/**
 * Decrypt one value of `store`, for tests only. Values never leave the store in the app: no
 * production code imports this, and `index.ts` does not re-export it.
 */
export function readValueForTests(store: object, name: string): Promise<string> {
  const read = testReaders.get(store)
  if (read == null) return Promise.reject(new Error('Not a LocalSecrets store.'))
  return read(name)
}
