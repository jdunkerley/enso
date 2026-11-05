/**
 * @file The training lock: one AOT training at a time across IDE processes (a second window, or a
 * second instance of another version). It is `<root>/train.lock`, holding the owner's pid.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errorCode } from '../localMetadata/jsonFile.js'

/** The lock file's name, which the clean-up of old keys leaves alone. */
export const LOCK_FILE_NAME = 'train.lock'

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

/**
 * Take the training lock in `root`: create `<root>/train.lock` with this pid, taking over a lock
 * whose pid is not alive (or unreadable). Returns the function that releases it, or `undefined`
 * when another live process holds it.
 */
export async function acquireTrainingLock(
  root: string,
): Promise<(() => Promise<void>) | undefined> {
  await fs.mkdir(root, { recursive: true })
  const file = path.join(root, LOCK_FILE_NAME)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await createLock(file)) {
      let released = false
      return async () => {
        if (released) return
        released = true
        await fs.rm(file, { force: true })
      }
    }
    let holder: number
    try {
      holder = Number((await fs.readFile(file, 'utf8')).trim())
    } catch (error) {
      // Released between the two calls: try again.
      if (errorCode(error) === 'ENOENT') continue
      throw error
    }
    // This process (another cache object) or another live one holds it.
    if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) return undefined
    // A dead (or unreadable) holder: take the lock over.
    await fs.rm(file, { force: true })
  }
  return undefined
}
