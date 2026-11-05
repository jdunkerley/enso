/**
 * @file The training lock: one AOT training at a time across IDE processes (a second window, or a
 * second instance of another version). It is `<root>/train.lock`, holding the owner's pid, and its
 * owner touches it every minute while it holds it.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errorCode } from '../localMetadata/jsonFile.js'

/** The lock file's name. */
export const LOCK_FILE_NAME = 'train.lock'

/** How often a holder touches the lock. */
const HEARTBEAT_MS = 60_000
/**
 * A lock not touched for this long is stale whatever its pid says: pids are reused (quickly on
 * Windows), so a crashed IDE's pid can belong to an unrelated live process.
 */
export const STALE_LOCK_MS = 10 * 60_000

/** Whether a process with `pid` exists (`EPERM`: it does, owned by someone else). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) !== 'ESRCH'
  }
}

/** Create the lock file exclusively with this process's pid; `false` when it already exists. */
async function createLock(file: string): Promise<boolean> {
  try {
    const handle = await fs.open(file, 'wx')
    try {
      await handle.writeFile(String(process.pid))
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    throw error
  }
}

/** Whether the lock in `file` is held: a live pid that has touched it recently. */
async function isHeld(file: string): Promise<boolean | undefined> {
  let text: string
  let touched: number
  try {
    text = await fs.readFile(file, 'utf8')
    touched = (await fs.stat(file)).mtimeMs
  } catch (error) {
    // Released meanwhile: not held.
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const holder = Number(text.trim())
  return (
    Number.isInteger(holder) &&
    holder > 0 &&
    isAlive(holder) &&
    Date.now() - touched < STALE_LOCK_MS
  )
}

/**
 * Take the training lock in `root`: create `<root>/train.lock` with this pid, taking over a lock
 * whose pid is not alive, that is unreadable, or that has not been touched for
 * {@link STALE_LOCK_MS}. Returns the function that releases it, or `undefined` when another
 * process holds it.
 *
 * A takeover first renames the stale file to a name of its own, which only one of two racing
 * takers can do, and then creates the lock exclusively, so two takers never both hold it.
 */
export async function acquireTrainingLock(
  root: string,
): Promise<(() => Promise<void>) | undefined> {
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, LOCK_FILE_NAME)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await createLock(file)) {
      const heartbeat = setInterval(() => {
        const now = new Date()
        void fs.utimes(file, now, now).catch(() => undefined)
      }, HEARTBEAT_MS)
      heartbeat.unref()
      let released = false
      return async () => {
        if (released) return
        released = true
        clearInterval(heartbeat)
        await fs.rm(file, { force: true })
      }
    }
    const held = await isHeld(file)
    if (held === undefined) continue
    if (held) return undefined
    const stale = `${file}.stale-${process.pid}-${Date.now()}`
    try {
      await fs.rename(file, stale)
    } catch (error) {
      // Another taker moved it first: try to create it again (one of us will).
      if (errorCode(error) === 'ENOENT') continue
      throw error
    }
    await fs.rm(stale, { force: true }).catch(() => undefined)
  }
  return undefined
}
