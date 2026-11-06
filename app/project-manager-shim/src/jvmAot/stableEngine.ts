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
 * launch. A symlink at a fixed path does not help: the native launcher finds itself through its
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
 * Nothing here guards against two processes copying at once: Electron's single-instance lock
 * means one IDE per `userData`, which is where the copies live.
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

const ENGINE_DIRECTORY = 'engine'
const MARKER = '.complete'
/** An unfinished copy: `.<version>-<random>.tmp`. */
const TEMPORARY = /^\..*\.tmp$/
/** How many other versions' copies are kept: the most recently used one (a release and a nightly). */
const OTHERS_KEPT = 1

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
 * other versions' copies but the most recently used one.
 */
export async function stableEnginePath(options: StableEngineOptions): Promise<string> {
  const ready = await readyStableEngine(options)
  if (ready != null) return ready
  const current = await fingerprint(options.bundleRoot)
  if (current == null) throw new Error(`No engine bundle at ${options.bundleRoot}`)
  const engineDirectory = path.join(options.userData, ENGINE_DIRECTORY)
  await fs.mkdir(engineDirectory, { recursive: true })
  await deleteUnfinished(engineDirectory)
  const temporary = path.join(
    engineDirectory,
    `.${options.version}-${crypto.randomBytes(6).toString('hex')}.tmp`,
  )
  const copy = copyDirectory(options)
  try {
    await fs.cp(options.bundleRoot, temporary, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    })
    await fs.writeFile(path.join(temporary, MARKER), current.text)
    // An older or unfinished copy of this version.
    await fs.rm(copy, { recursive: true, force: true })
    await renameWithRetry(temporary, copy)
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  await deleteOtherVersions(engineDirectory, options.version)
  return launcherIn(copy, current.dist)
}

async function deleteUnfinished(engineDirectory: string): Promise<void> {
  for (const name of await fs.readdir(engineDirectory)) {
    if (TEMPORARY.test(name)) {
      await fs.rm(path.join(engineDirectory, name), { recursive: true, force: true })
    }
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

async function deleteOtherVersions(engineDirectory: string, keep: string): Promise<void> {
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
  for (const { name } of others.slice(OTHERS_KEPT)) {
    await fs
      .rm(path.join(engineDirectory, name), { recursive: true, force: true })
      .catch((error: unknown) => console.warn(`Could not delete the engine copy ${name}:`, error))
  }
}
