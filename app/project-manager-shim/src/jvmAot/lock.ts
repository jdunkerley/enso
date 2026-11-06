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
/**
 * A lock or takeover file is written to `<file>.new-<pid>-<uuid>` and linked into place, so it never
 * exists empty (Note [A Lock File Appears Complete]); such a file left by a crash is cleaned up.
 */
const NEW_INFIX = '.new-'
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
/**
 * A takeover file older than this is stale whatever its pid says. It covers only a short critical
 * section: a few file operations (a `look`, an `rm`, a linked create, a `readdir` and `stat` of
 * the root for old asides, or one `utimes`), milliseconds even on a slow disk. Kept at the lock's
 * 10 minutes, a crashed taker whose pid was reused would make every heartbeat skip for so long
 * that the live holder's lock went stale too (Note [Takeovers Are Serialised]).
 */
export const STALE_TAKEOVER_MS = 30_000
/**
 * An empty lock or takeover file younger than this is a write in progress (the fallback create,
 * where hard links are refused), not a stale file.
 */
const WRITE_IN_PROGRESS_MS = 5_000

/** Test hooks. */
export interface LockHooks {
  /** Called while holding the takeover file, between the inspection of a stale lock and its removal. */
  readonly beforeTakeover?: () => Promise<void>
  /** Called in a release while holding the takeover file, after the token check and before `rm`. */
  readonly beforeReleaseAct?: () => Promise<void>
  /** Replaces {@link HEARTBEAT_MS}. */
  readonly heartbeatMs?: number
  /** Replaces how many times a release tries for the takeover file. */
  readonly releaseAttempts?: number
  /** Called when a stale takeover file has been seen twice, just before it is removed. */
  readonly beforeStaleTakeoverRemoval?: () => Promise<void>
  /** Replaces `fs.link` when a file is linked into place. */
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

/* Note [A Lock File Appears Complete]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `open(…, 'wx')` creates a file empty and the content follows in a second write. A process that
 * read it in between saw `""`, no pid, so a stale file, and deleted it: two live takers could then
 * both hold the takeover file, with no crash at all (review of #603). So a file is written in full
 * under a unique name and hard-linked to its place, which fails with `EEXIST` as `wx` does and
 * never shows it empty. Where hard links are refused (FAT, some network or synced folders, an
 * antivirus), it falls back to `wx` and a write, and an empty file younger than
 * {@link WRITE_IN_PROGRESS_MS} is read as held.
 */
/** Create `file` exclusively with `content`; `false` when it already exists. */
async function createLock(file: string, content: string, hooks: LockHooks = {}): Promise<boolean> {
  const fresh = `${file}${NEW_INFIX}${process.pid}-${crypto.randomUUID()}`
  await fs.writeFile(fresh, content, { flag: 'wx' })
  try {
    await (hooks.link ?? fs.link)(fresh, file)
    return true
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false
    return createUnlinked(file, content)
  } finally {
    await fs.rm(fresh, { force: true }).catch(() => undefined)
  }
}

/** The fallback create, without a hard link (Note [A Lock File Appears Complete]). */
async function createUnlinked(file: string, content: string): Promise<boolean> {
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

/**
 * Whether the file seen is held: a live pid that has touched it within `staleMs`, or an empty file
 * still being written (Note [A Lock File Appears Complete]).
 */
function isHeld(seen: Seen, staleMs: number = STALE_LOCK_MS): boolean {
  const age = Date.now() - seen.mtimeMs
  if (seen.content === '') return age < WRITE_IN_PROGRESS_MS
  const holder = Number(seen.content.trim().split(/\s+/)[0])
  return Number.isInteger(holder) && holder > 0 && isAlive(holder) && age < staleMs
}

/**
 * Delete locks moved aside by takeovers of earlier versions that never finished, and files a crash
 * left before they were linked into place.
 */
async function deleteOldStaleLocks(root: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return
  }
  for (const name of entries) {
    // The lock's own files only: nothing else in the root is ever deleted here.
    if (!name.startsWith(LOCK_FILE_NAME)) continue
    if (!name.startsWith(LOCK_FILE_NAME + STALE_INFIX) && !name.includes(NEW_INFIX)) continue
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
 * seconds, then leaves its lock (below). A takeover file is stale when its pid is dead or it is
 * older than {@link STALE_TAKEOVER_MS} (30 s, not the lock's 10 minutes: it is held for
 * milliseconds, and a crashed taker's reused pid must not stop the holder's heartbeat long enough
 * for the holder's own lock to go stale). A stale one is deleted if it still holds what was seen;
 * that check and delete are not atomic, so a stale takeover file can be deleted by two processes,
 * one of them deleting the other's fresh one, but only when a taker has crashed or stalled for 30 s
 * inside the section, and the worst outcome is one duplicate training, which cannot corrupt the
 * cache (each training writes its own `.tmp` and renames it). Files appear complete (Note [A Lock
 * File Appears Complete]), so a file being created is never taken for a stale one. Creating a
 * lock where there is none needs no takeover file: the exclusive create decides that alone.
 *
 * A release that gives up does not delete its lock without the takeover file: that is the
 * check-then-act this Note removes. The lock then blocks training, this process's included, until
 * it is 10 minutes old; it needs the takeover file held for two seconds by someone else, which a
 * live taker never does.
 */
/**
 * Run `act` holding `<file>.takeover` (Note [Takeovers Are Serialised]). Returns its result, or
 * `busy` when another process holds the takeover file.
 */
async function withTakeover<T>(
  file: string,
  act: () => Promise<T>,
  hooks: LockHooks,
): Promise<T | 'busy'> {
  const takeover = file + TAKEOVER_SUFFIX
  const content = `${process.pid} ${crypto.randomUUID()}`
  if (!(await createLock(takeover, content, hooks))) {
    const seen = await look(takeover)
    if (seen !== undefined) {
      if (isHeld(seen, STALE_TAKEOVER_MS)) return 'busy'
      // Left by a taker that crashed: delete it if it is still what was seen. The time is compared
      // too: every empty file (a fallback create still unwritten) has the same content.
      await hooks.beforeStaleTakeoverRemoval?.()
      const again = await look(takeover)
      if (again?.content === seen.content && again.mtimeMs === seen.mtimeMs) {
        await fs.rm(takeover, { force: true })
      }
    }
    if (!(await createLock(takeover, content, hooks))) return 'busy'
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
      void withTakeover(
        file,
        async () => {
          if (!(await ours())) return
          const now = new Date()
          await fs.utimes(file, now, now)
        },
        hooks,
      ).catch(() => undefined)
    }, hooks.heartbeatMs ?? HEARTBEAT_MS)
    heartbeat.unref()
    let released = false
    return async () => {
      if (released) return
      released = true
      clearInterval(heartbeat)
      for (let attempt = 0; attempt < (hooks.releaseAttempts ?? RELEASE_ATTEMPTS); attempt++) {
        const result = await withTakeover(
          file,
          async () => {
            if (!(await ours())) return
            await hooks.beforeReleaseAct?.()
            await fs.rm(file, { force: true })
          },
          hooks,
        ).catch(() => undefined)
        if (result !== 'busy') return
        await new Promise((resolve) => setTimeout(resolve, RELEASE_RETRY_MS))
      }
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await createLock(file, content, hooks)) return holding()
    const seen = await look(file)
    if (seen === undefined) continue
    if (isHeld(seen)) return undefined
    const result = await withTakeover(
      file,
      async () => {
        // Looked at again under the takeover file: what was seen may have been taken over already.
        const now = await look(file)
        if (now !== undefined) {
          if (isHeld(now)) return false
          await hooks.beforeTakeover?.()
          await fs.rm(file, { force: true })
        }
        await deleteOldStaleLocks(root)
        // Exclusive still: a new process may create the lock in the moment it is gone, and holds it.
        return createLock(file, content, hooks)
      },
      hooks,
    )
    if (result === true) return holding()
    // Another taker is at work, or the lock is held now: either way someone live has it.
    return undefined
  }
  return undefined
}
