/**
 * @file A copy of a Linux AppImage's bundled engine at a path that survives remounts, so that the
 * JDK AOT cache can be used (Note [The AppImage Engine Is Copied Out]).
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { renameWithRetry } from '../localMetadata/jsonFile.js'

/* Note [The AppImage Engine Is Copied Out]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * An AppImage mounts itself at a new `/tmp/.mount_<random>` at every launch. A JDK AOT cache
 * records the module path and the runtime it was trained with, and the JVM refuses it when they
 * moved (`shared class paths mismatch`), so a cache trained from the mount is useless at the next
 * launch. A symlink at a fixed path did not help the (since removed) native launcher, which found itself through its
 * resolved executable, so the JVM's paths are the mount's whichever path started it (experiment X1
 * of the JVM-by-default plan, discussion #518). So the bundle (`resources/enso`: `.enso.bundle`,
 * `dist/`, `runtime/`, about 1.8 GB) is copied once per build to `<userData>/engine/<version>/`,
 * times kept. The `.enso.bundle` marker matters: without it the launcher does not find the bundled
 * runtime and falls back to `JAVA_HOME`, or to nothing.
 *
 * The copy is made in a temporary directory, with a `.complete` file written last that holds the
 * bundle's fingerprint, and renamed into place. A dev build keeps its version from build to build,
 * so the fingerprint, not the version, says whether the copy is current. It is a few `stat`s (the
 * launcher, `runtime.jar`, the runtime's name): a walk of the whole mount took 2 s cold.
 *
 * A copy is made only when there is room for the bundle plus a margin (1 GiB or 20%, whichever is
 * more), after deleting the other copies if that is what it takes: filling the disk would fail
 * every other write on it until the copy is removed. A copy that fails (or finds no room) leaves
 * `.failed.json` with the bundle's fingerprint and the time, and is not tried again for that build
 * for a day: retrying 1.8 GB at every launch would be worse than running without the cache.
 *
 * Nothing here guards against two processes copying at once: Electron's single-instance lock
 * means one IDE per `userData`, which is where the copies live. An engine left running by a
 * crashed IDE can still be using a copy, so a copy holding a running process's executable is not
 * deleted (`/proc/<pid>/exe`, Linux only; elsewhere nothing is checked).
 */

/** Where the bundle is and where its copy goes. */
export interface StableEngineOptions {
  /** Electron's `userData`: the copy goes to `<userData>/engine/<version>/`. */
  readonly userData: string
  /** The app version, which names the copy's directory. */
  readonly version: string
  /** The bundle: `<resources>/enso`, holding `.enso.bundle`, `dist/<version>/` and `runtime/`. */
  readonly bundleRoot: string
}

/** What a copy needs from the system; the tests replace them. */
export interface StableEngineHooks {
  /** The bytes free for an unprivileged user on the file system of `directory`. */
  readonly freeBytes: (directory: string) => Promise<number>
  /** Whether a running process's executable is inside `directory`. */
  readonly isInUse: (directory: string) => Promise<boolean>
  /** Copies the bundle `from` into `to`, which does not exist yet. */
  readonly copy: (from: string, to: string) => Promise<void>
  readonly now: () => number
}

const ENGINE_DIRECTORY = 'engine'
const MARKER = '.complete'
const FAILURE = '.failed.json'
/** An unfinished copy: `.<version>-<random>.tmp`. */
const TEMPORARY = /^\..*\.tmp$/
/** How many other versions' copies are kept: the most recently used one (a release and a nightly). */
const OTHERS_KEPT = 1
const GIB = 1024 ** 3
/** How long a failed copy of one build is not tried again. */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

/** Whether any process's executable (`/proc/<pid>/exe`) is inside `directory`; Linux only. */
export async function runningExecutableIn(directory: string): Promise<boolean> {
  if (process.platform !== 'linux') return false
  // `/proc/<pid>/exe` is a resolved path, so the directory must be too (`~/.config` may be a symlink).
  const resolved = await fs.realpath(directory).catch(() => path.resolve(directory))
  const prefix = resolved + path.sep
  let pids: string[]
  try {
    pids = (await fs.readdir('/proc')).filter((name) => /^\d+$/.test(name))
  } catch {
    return false
  }
  for (const pid of pids) {
    try {
      if ((await fs.readlink(`/proc/${pid}/exe`)).startsWith(prefix)) return true
    } catch {
      // Gone, or another user's.
    }
  }
  return false
}

/** The real system. */
export const SYSTEM_HOOKS: StableEngineHooks = {
  freeBytes: async (directory) => {
    const stats = await fs.statfs(directory)
    return stats.bavail * stats.bsize
  },
  isInUse: runningExecutableIn,
  copy: (from, to) =>
    fs.cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    }),
  now: () => Date.now(),
}

/** The bundle's one `dist/<version>` directory name and its fingerprint, or `undefined`. */
async function fingerprint(
  bundleRoot: string,
): Promise<{ readonly dist: string; readonly text: string } | undefined> {
  const stamp = async (file: string) => {
    try {
      const stat = await fs.stat(file)
      // Whole milliseconds: `fs.cp`'s `preserveTimestamps` rounds to them.
      return [stat.size, Math.round(stat.mtimeMs)]
    } catch {
      return null
    }
  }
  const directories = async (directory: string) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }
  const dists = await directories(path.join(bundleRoot, 'dist'))
  if (dists.length !== 1) return undefined
  const dist = dists[0]!
  const launcher = await stamp(launcherIn(bundleRoot, dist))
  if (launcher == null) return undefined
  const text = JSON.stringify({
    dist,
    launcher,
    runtimeJar: await stamp(path.join(bundleRoot, 'dist', dist, 'component', 'runtime.jar')),
    runtimes: await directories(path.join(bundleRoot, 'runtime')),
  })
  return { dist, text }
}

function launcherIn(root: string, dist: string): string {
  return path.join(root, 'dist', dist, 'bin', 'enso')
}

function copyDirectory(options: StableEngineOptions): string {
  return path.join(options.userData, ENGINE_DIRECTORY, options.version)
}

/**
 * The copy's launcher when a complete copy of this very bundle exists (and the copy is marked as
 * just used), else `undefined`. Cheap: it copies nothing.
 */
export async function readyStableEngine(options: StableEngineOptions): Promise<string | undefined> {
  const current = await fingerprint(options.bundleRoot)
  if (current == null) return undefined
  const copy = copyDirectory(options)
  const marker = path.join(copy, MARKER)
  let recorded: string
  try {
    recorded = await fs.readFile(marker, 'utf8')
  } catch {
    return undefined
  }
  if (recorded !== current.text) return undefined
  const now = new Date()
  // "Last used", for the clean-up of other versions; best effort.
  await fs.utimes(marker, now, now).catch(() => undefined)
  return launcherIn(copy, current.dist)
}

/**
 * The launcher (`bin/enso`) of a copy of the bundle at `<userData>/engine/<version>/`, copying it
 * first when there is no complete copy of this bundle. A copy also deletes unfinished copies and
 * other versions' copies but the most recently used one. Rejects when the copy fails, when there
 * is no room for it, when a running process uses the stale copy it would replace, or when this
 * build's copy failed less than a day ago.
 */
export async function stableEnginePath(
  options: StableEngineOptions,
  hooks: StableEngineHooks = SYSTEM_HOOKS,
): Promise<string> {
  const ready = await readyStableEngine(options)
  if (ready != null) return ready
  const current = await fingerprint(options.bundleRoot)
  if (current == null) throw new Error(`No engine bundle at ${options.bundleRoot}`)
  const engineDirectory = path.join(options.userData, ENGINE_DIRECTORY)
  await fs.mkdir(engineDirectory, { recursive: true })
  const failure = await readFailure(engineDirectory)
  if (
    failure != null &&
    failure.fingerprint === current.text &&
    hooks.now() - failure.at < RETRY_AFTER_MS
  ) {
    throw new Error(
      `Copying this build's engine failed at ${new Date(failure.at).toISOString()} ` +
        `(${failure.reason}); not retried for a day, or until a new build.`,
    )
  }
  const copy = copyDirectory(options)
  if (await hooks.isInUse(copy)) {
    throw new Error(`The engine copy at ${copy} is in use by a running process.`)
  }
  await deleteUnfinished(engineDirectory)
  const temporary = path.join(
    engineDirectory,
    `.${options.version}-${crypto.randomBytes(6).toString('hex')}.tmp`,
  )
  try {
    await ensureRoom(options, engineDirectory, hooks)
    await hooks.copy(options.bundleRoot, temporary)
    await fs.writeFile(path.join(temporary, MARKER), current.text)
    // An older or unfinished copy of this version.
    await removeTree(copy)
    await renameWithRetry(temporary, copy)
  } catch (error) {
    await removeTree(temporary).catch(() => undefined)
    await writeFailure(engineDirectory, current.text, hooks.now(), error).catch(() => undefined)
    throw error
  }
  await fs.rm(path.join(engineDirectory, FAILURE), { force: true }).catch(() => undefined)
  await deleteOtherVersions(engineDirectory, options.version, OTHERS_KEPT, hooks)
  return launcherIn(copy, current.dist)
}

interface Failure {
  readonly fingerprint: string
  readonly at: number
  readonly reason: string
}

async function readFailure(engineDirectory: string): Promise<Failure | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(engineDirectory, FAILURE), 'utf8'),
    )
    if (
      typeof parsed === 'object' &&
      parsed != null &&
      'fingerprint' in parsed &&
      typeof parsed.fingerprint === 'string' &&
      'at' in parsed &&
      typeof parsed.at === 'number'
    ) {
      const reason = 'reason' in parsed && typeof parsed.reason === 'string' ? parsed.reason : ''
      return { fingerprint: parsed.fingerprint, at: parsed.at, reason }
    }
  } catch {
    // None, or unreadable: as good as none.
  }
  return undefined
}

async function writeFailure(
  engineDirectory: string,
  fingerprintText: string,
  at: number,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error)
  await fs.writeFile(
    path.join(engineDirectory, FAILURE),
    JSON.stringify({ fingerprint: fingerprintText, at, reason }),
  )
}

/** The bytes of every file under `directory` (links not followed). */
async function treeSize(directory: string): Promise<number> {
  let total = 0
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) total += await treeSize(entryPath)
    else total += (await fs.lstat(entryPath)).size
  }
  return total
}

/**
 * Make sure the copy fits with a margin (1 GiB or 20% of the bundle, whichever is more): when it
 * does not, delete every other copy (this version's stale one included) and look again; throw when
 * it still does not.
 */
async function ensureRoom(
  options: StableEngineOptions,
  engineDirectory: string,
  hooks: StableEngineHooks,
): Promise<void> {
  const size = await treeSize(options.bundleRoot)
  const needed = size + Math.max(GIB, size * 0.2)
  if ((await hooks.freeBytes(engineDirectory)) >= needed) return
  await deleteOtherVersions(engineDirectory, undefined, 0, hooks)
  const free = await hooks.freeBytes(engineDirectory)
  if (free < needed) {
    const gib = (bytes: number) => (bytes / GIB).toFixed(1)
    throw new Error(
      `Not enough free space to copy the engine: ${gib(free)} GiB free, ${gib(needed)} GiB needed.`,
    )
  }
}

/**
 * `fs.rm` of a tree; when that fails for want of permission (`fs.cp` keeps the bundle's modes,
 * and a read-only directory cannot be emptied), make every directory writable and try again.
 */
async function removeTree(directory: string): Promise<void> {
  try {
    await fs.rm(directory, { recursive: true, force: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error
    await makeWritable(directory)
    await fs.rm(directory, { recursive: true, force: true })
  }
}

async function makeWritable(directory: string): Promise<void> {
  await fs.chmod(directory, 0o755).catch(() => undefined)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await makeWritable(path.join(directory, entry.name))
  }
}

async function deleteUnfinished(engineDirectory: string): Promise<void> {
  for (const name of await fs.readdir(engineDirectory)) {
    if (TEMPORARY.test(name)) await removeTree(path.join(engineDirectory, name))
  }
}

/** When a copy was last used: its marker's time (touched by `readyStableEngine`), else its own. */
async function lastUsed(directory: string): Promise<number> {
  try {
    return (await fs.stat(path.join(directory, MARKER))).mtimeMs
  } catch {
    return (await fs.stat(directory)).mtimeMs
  }
}

/**
 * Delete the copies other than `keep`'s, except the `kept` most recently used ones and any that a
 * running process uses.
 */
async function deleteOtherVersions(
  engineDirectory: string,
  keep: string | undefined,
  kept: number,
  hooks: StableEngineHooks,
): Promise<void> {
  const others: { name: string; usedAt: number }[] = []
  for (const entry of await fs.readdir(engineDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === keep || TEMPORARY.test(entry.name)) continue
    try {
      others.push({
        name: entry.name,
        usedAt: await lastUsed(path.join(engineDirectory, entry.name)),
      })
    } catch {
      // Gone meanwhile.
    }
  }
  others.sort((a, b) => b.usedAt - a.usedAt)
  for (const { name } of others.slice(kept)) {
    const directory = path.join(engineDirectory, name)
    if (await hooks.isInUse(directory)) {
      console.info(`Keeping the engine copy ${name}: a running process uses it.`)
      continue
    }
    await removeTree(directory).catch((error: unknown) =>
      console.warn(`Could not delete the engine copy ${name}:`, error),
    )
  }
}
