/** @file Atomic, per-path serialised JSON file I/O. */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** Error codes for which a rename over an existing file is retried (Windows file locks). */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_DELAY_MS = 20

/** The tail of the action chain for each absolute path. */
const queues = new Map<string, Promise<unknown>>()

/**
 * Run `action` after every earlier action queued for the same file has settled.
 *
 * The queue is keyed by absolute path and shared by everything in this process that reads and
 * writes the file, so a read-modify-write is never interleaved with another one.
 */
export function serialised<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath)
  const previous = queues.get(key) ?? Promise.resolve()
  const result = previous.then(action, action)
  const tail = result.then(
    () => {},
    () => {},
  )
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return result
}

/**
 * Write `value` as JSON to a temporary file next to `filePath`, then rename it over `filePath`.
 * Readers see either the old content or the new content, never a partial write.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  )
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2))
  try {
    await renameWithRetry(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

/**
 * Rename `from` over `to`, retrying a few times on the errors Windows reports while another
 * process briefly holds either file.
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !RETRYABLE_RENAME_CODES.has(errorCode(error) ?? '')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * attempt))
    }
  }
}

/** Whether `value` is a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

/** The `code` of a Node.js system error, if any. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error != null && 'code' in error ?
      String(error.code)
    : undefined
}

/** Read and parse a JSON file. A missing file reads as `undefined`; invalid JSON throws. */
export async function readJson(filePath: string): Promise<unknown> {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  return JSON.parse(text)
}

/**
 * Serialised read-modify-write of a JSON file. `update` receives the parsed content, or
 * `undefined` when the file does not exist, and returns the value to write.
 * @throws {SyntaxError} when the existing file is not valid JSON; the file is left untouched.
 */
export function updateJsonFile<T>(
  filePath: string,
  update: (current: unknown) => T | Promise<T>,
): Promise<T> {
  return serialised(filePath, async () => {
    const next = await update(await readJson(filePath))
    await writeJsonAtomic(filePath, next)
    return next
  })
}

/** Options for {@link readVersionedJson}. */
export interface ReadVersionedJsonOptions<T> {
  /** The newest `version` this code understands. */
  readonly version: number
  /** Validate the parsed JSON; `undefined` marks the file as corrupt. */
  readonly parse: (json: unknown) => T | undefined
  readonly logger: Pick<Console, 'warn'>
  readonly now: () => Date
}

/**
 * Read a JSON file that carries a top-level `version` number.
 *
 * - A missing file reads as `undefined`.
 * - A file that is not valid JSON, or that `parse` rejects, is renamed to
 *   `<name>.corrupt-<timestamp>` and reads as `undefined`.
 * - A file whose `version` is newer than `options.version` is renamed to
 *   `<name>.newer-<timestamp>` and reads as `undefined`.
 *
 * One warning is logged for each file moved aside. This does not serialise itself: call it from
 * inside {@link serialised} for the same path.
 */
export async function readVersionedJson<T>(
  filePath: string,
  options: ReadVersionedJsonOptions<T>,
): Promise<T | undefined> {
  let json: unknown
  try {
    json = await readJson(filePath)
  } catch (error) {
    if (error instanceof SyntaxError) {
      await moveAside(filePath, 'corrupt', options)
      return undefined
    }
    throw error
  }
  if (json === undefined) return undefined
  const version =
    typeof json === 'object' && json != null && 'version' in json ? json.version : undefined
  if (typeof version === 'number' && version > options.version) {
    await moveAside(filePath, 'newer', options)
    return undefined
  }
  const parsed = version === undefined ? undefined : options.parse(json)
  if (parsed === undefined) {
    await moveAside(filePath, 'corrupt', options)
    return undefined
  }
  return parsed
}

async function moveAside(
  filePath: string,
  reason: 'corrupt' | 'newer',
  options: Pick<ReadVersionedJsonOptions<unknown>, 'logger' | 'now'>,
): Promise<void> {
  const timestamp = options.now().toISOString().replace(/[:.]/g, '-')
  const asidePath = `${filePath}.${reason}-${timestamp}`
  await renameWithRetry(filePath, asidePath)
  options.logger.warn(
    reason === 'corrupt' ?
      `'${filePath}' could not be read; it was moved to '${asidePath}' and an empty one is used.`
    : `'${filePath}' was written by a newer version; it was moved to '${asidePath}' and an empty one is used.`,
  )
}
