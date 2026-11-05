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
/** A lock moved aside by a takeover is `<lock>.stale-<pid>-<time>` until it is deleted. */
const STALE_INFIX = '.stale-'

/** How often a holder touches the lock. */
const HEARTBEAT_MS = 60_000
/**
 * A lock not touched for this long is stale whatever its pid says: pids are reused (quickly on
 * Windows), so a crashed IDE's pid can belong to an unrelated live process.
 */
export const STALE_LOCK_MS = 10 * 60_000

/** Test hooks: called between a taker's inspection of a stale lock and its takeover. */
export interface LockHooks {
  readonly beforeTakeover?: () => Promise<void>
  /** Replaces `fs.link` when a takeover puts back a lock it should not have moved. */
  readonly link?: (existing: string, target: string) => Promise<void>
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

/**
 * Take a stale lock seen as `seen`: move whatever is at `file` aside, and keep it moved only if
 * it is the lock that was seen. Another taker may have taken over in between, and then what the
 * rename moved is that taker's fresh lock: it is put back (unless something is there by then),
 * and this taker gives up. Returns whether the stale lock is gone and the lock may be created.
 */
async function takeOver(file: string, seen: Seen, hooks: LockHooks): Promise<boolean> {
  const aside = `${file}${STALE_INFIX}${process.pid}-${Date.now()}-${crypto.randomUUID()}`
  try {
    await fs.rename(file, aside)
  } catch (error) {
    // Another taker moved it first.
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
  const moved = await look(aside)
  if (moved != null && moved.content === seen.content && moved.mtimeMs === seen.mtimeMs) {
    await fs.rm(aside, { force: true }).catch(() => undefined)
    return true
  }
  // Not the stale lock: put it back without replacing anything that is there now.
  try {
    await (hooks.link ?? fs.link)(aside, file)
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      // Another lock is there now and stands; the moved one is a duplicate of nothing.
      await fs.rm(aside, { force: true }).catch(() => undefined)
      return false
    }
    // No hard links here (FAT, some network or synced folders) or a refusal (`EPERM` from an
    // antivirus): the moved lock is live, so it must not be deleted. Rename it back while nothing
    // is in its place; otherwise leave it aside, where the stale-aside clean-up finds it later.
    if ((await look(file)) === undefined) {
      await fs.rename(aside, file).catch(() => undefined)
    }
    return false
  }
  await fs.rm(aside, { force: true }).catch(() => undefined)
  return false
}

/**
 * Take the training lock in `root`: create `<root>/train.lock` with this pid and a fresh token,
 * taking over a lock whose pid is not alive, that is unreadable, or that has not been touched for
 * {@link STALE_LOCK_MS} (see `takeOver`). Returns the function that releases it, or `undefined`
 * when another process holds it. The heartbeat and the release touch the file only while it holds
 * this acquisition's token, so a holder whose lock was taken over never touches the new holder's.
 */
export async function acquireTrainingLock(
  root: string,
  hooks: LockHooks = {},
): Promise<(() => Promise<void>) | undefined> {
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, LOCK_FILE_NAME)
  const content = `${process.pid} ${crypto.randomUUID()}`
  const ours = async () => (await look(file))?.content === content
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await createLock(file, content)) {
      const heartbeat = setInterval(() => {
        void (async () => {
          if (!(await ours())) return
          const now = new Date()
          await fs.utimes(file, now, now)
        })().catch(() => undefined)
      }, HEARTBEAT_MS)
      heartbeat.unref()
      let released = false
      return async () => {
        if (released) return
        released = true
        clearInterval(heartbeat)
        if (await ours().catch(() => false)) await fs.rm(file, { force: true })
      }
    }
    const seen = await look(file)
    if (seen === undefined) continue
    if (isHeld(seen)) return undefined
    await hooks.beforeTakeover?.()
    await deleteOldStaleLocks(root)
    if (!(await takeOver(file, seen, hooks))) {
      // Someone else took it over: whoever holds it now is live.
      const now = await look(file)
      if (now != null && isHeld(now)) return undefined
    }
  }
  return undefined
}
