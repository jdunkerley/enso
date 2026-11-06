/**
 * @file The training lock: one AOT training at a time across IDE processes (a second window, or a
 * second instance of another version). It is `<root>/train.lock`, holding the owner's pid and a
 * random token of this acquisition, and its owner touches it every minute while it holds it.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errorCode } from '../localMetadata/jsonFile.js'

/** The lock file's name. */
export const LOCK_FILE_NAME = 'train.lock'
/**
 * The file a process creates exclusively before it may inspect, take over, touch or release the
 * lock (Note [Takeovers Are Serialised]).
 */
export const TAKEOVER_SUFFIX = '.takeover'
/**
 * Earlier versions moved a stale lock aside to `<lock>.stale-<pid>-<time>`; such files left by a
 * crash are still cleaned up.
 */
const STALE_INFIX = '.stale-'
/** How often, and how many times, a release waits for a takeover under way to finish. */
const RELEASE_RETRY_MS = 50
const RELEASE_ATTEMPTS = 40

/** How often a holder touches the lock. */
const HEARTBEAT_MS = 60_000
/**
 * A lock not touched for this long is stale whatever its pid says: pids are reused (quickly on
 * Windows), so a crashed IDE's pid can belong to an unrelated live process.
 */
export const STALE_LOCK_MS = 10 * 60_000

/** Test hooks. */
export interface LockHooks {
  /** Called while holding the takeover file, between the inspection of a stale lock and its removal. */
  readonly beforeTakeover?: () => Promise<void>
}

/** Whether a process with `pid` exists (`EPERM`: it does, owned by someone else). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
}

/** Create the lock file exclusively with `content`; `false` when it already exists. */
async function createLock(file: string, content: string): Promise<boolean> {
  try {
    const handle = await fs.open(file, 'wx')
    try {
      await handle.writeFile(content)
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  }
}

/** A lock file as one taker saw it. */
interface Seen {
  readonly content: string
  readonly mtimeMs: number
}

/** What is at `file` now, or `undefined` when nothing is. */
async function look(file: string): Promise<Seen | undefined> {
  try {
    const content = await fs.readFile(file, 'utf8')
    const mtimeMs = (await fs.stat(file)).mtimeMs
    return { content, mtimeMs }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/** Whether the lock seen is held: a live pid that has touched it recently. */
function isHeld(seen: Seen): boolean {
  const holder = Number(seen.content.trim().split(/\s+/)[0])
  return (
    Number.isInteger(holder) &&
    holder > 0 &&
    isAlive(holder) &&
    Date.now() - seen.mtimeMs < STALE_LOCK_MS
  )
}

/** Delete locks moved aside by takeovers that never finished (a crash between rename and delete). */
async function deleteOldStaleLocks(root: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith(LOCK_FILE_NAME + STALE_INFIX)) continue
    const file = path.join(root, name)
    try {
      if (Date.now() - (await fs.stat(file)).mtimeMs > STALE_LOCK_MS) await fs.rm(file)
    } catch {
      // Gone meanwhile, or in use.
    }
  }
}

/* Note [Takeovers Are Serialised]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Only the process that has created `<lock>.takeover` exclusively (`wx`) may look at a lock it
 * did not just create and then change it: remove a stale lock, touch its own (the heartbeat) or
 * delete its own (the release). It deletes the takeover file when done. So:
 *
 * - A stale lock is removed in place (`rm`, then `wx` create), never moved aside and put back:
 *   the earlier rename, check and `link` back left a gap with no lock file, in which a third
 *   process could create its own, and the restored owner then trained without a lock (#603).
 * - A heartbeat or release checks the token and acts with no takeover able to land in between, so
 *   it never touches or deletes a new holder's lock (#603).
 *
 * A process that finds the takeover file held gives up: a taker, because another one is at work
 * (and whoever wins trains); a heartbeat, until its next tick; a release retries for up to two
 * seconds, then leaves its lock to go stale. A takeover file is stale by the lock's own rule (a
 * dead pid, or untouched for {@link STALE_LOCK_MS}), and such a file, left by a crash, is deleted
 * if it still holds what was seen. That check and delete are not atomic, but racing on it needs a
 * crashed taker and two new ones within microseconds, and the worst outcome is one duplicate
 * training, which cannot corrupt the cache (each training writes its own `.tmp` and renames it).
 * Creating a lock where there is none needs no takeover file: `wx` decides that alone.
 */
/**
 * Run `act` holding `<file>.takeover` (Note [Takeovers Are Serialised]). Returns its result, or
 * `busy` when another process holds the takeover file.
 */
async function withTakeover<T>(file: string, act: () => Promise<T>): Promise<T | 'busy'> {
  const takeover = file + TAKEOVER_SUFFIX
  const content = `${process.pid} ${crypto.randomUUID()}`
  if (!(await createLock(takeover, content))) {
    const seen = await look(takeover)
    if (seen !== undefined) {
      if (isHeld(seen)) return 'busy'
      // Left by a taker that crashed: delete it if it is still what was seen.
      if ((await look(takeover))?.content === seen.content) {
        await fs.rm(takeover, { force: true })
      }
    }
    if (!(await createLock(takeover, content))) return 'busy'
  }
  try {
    return await act()
  } finally {
    if ((await look(takeover).catch(() => undefined))?.content === content) {
      await fs.rm(takeover, { force: true }).catch(() => undefined)
    }
  }
}

/**
 * Take the training lock in `root`: create `<root>/train.lock` with this pid and a fresh token,
 * taking over a lock whose pid is not alive, that is unreadable, or that has not been touched for
 * {@link STALE_LOCK_MS}, under the takeover file (Note [Takeovers Are Serialised]). Returns the
 * function that releases it, or `undefined` when another process holds it or is taking it over.
 * The heartbeat and the release touch the file only while it holds this acquisition's token, and
 * only under the takeover file, so a holder whose lock was taken over never touches the new one.
 */
export async function acquireTrainingLock(
  root: string,
  hooks: LockHooks = {},
): Promise<(() => Promise<void>) | undefined> {
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, LOCK_FILE_NAME)
  const content = `${process.pid} ${crypto.randomUUID()}`
  const ours = async () => (await look(file))?.content === content
  const holding = () => {
    const heartbeat = setInterval(() => {
      void withTakeover(file, async () => {
        if (!(await ours())) return
        const now = new Date()
        await fs.utimes(file, now, now)
      }).catch(() => undefined)
    }, HEARTBEAT_MS)
    heartbeat.unref()
    let released = false
    return async () => {
      if (released) return
      released = true
      clearInterval(heartbeat)
      for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt++) {
        const result = await withTakeover(file, async () => {
          if (await ours()) await fs.rm(file, { force: true })
        }).catch(() => undefined)
        if (result !== 'busy') return
        await new Promise((resolve) => setTimeout(resolve, RELEASE_RETRY_MS))
      }
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await createLock(file, content)) return holding()
    const seen = await look(file)
    if (seen === undefined) continue
    if (isHeld(seen)) return undefined
    const result = await withTakeover(file, async () => {
      // Looked at again under the takeover file: what was seen may have been taken over already.
      const now = await look(file)
      if (now !== undefined) {
        if (isHeld(now)) return false
        await hooks.beforeTakeover?.()
        await fs.rm(file, { force: true })
      }
      await deleteOldStaleLocks(root)
      // `wx` still: a new process may create the lock in the moment it is gone, and then holds it.
      return createLock(file, content)
    })
    if (result === true) return holding()
    // Another taker is at work, or the lock is held now: either way someone live has it.
    return undefined
  }
  return undefined
}
