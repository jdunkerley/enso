/**
 * @file The JDK AOT cache's key and the paths it is made from (spec, stage 1d "Key"). A cache
 * records the module path and the runtime it was trained with, so the key moves with each of them,
 * with the app version and with the engine's `jvm.options`.
 */
import * as crypto from 'node:crypto'
import * as fsSync from 'node:fs'
import * as path from 'node:path'

/** What the key is computed from. */
export interface AotKeyInput {
  readonly appVersion: string
  readonly engineRoot: string
  readonly runtimeRoot: string
  readonly jvmOptionsText: string
}

/** The first 16 hex digits of SHA-256 over the four fields joined by `\0`. */
export function aotKey(input: AotKeyInput): string {
  return crypto
    .createHash('sha256')
    .update(
      [input.appVersion, input.engineRoot, input.runtimeRoot, input.jvmOptionsText].join('\0'),
    )
    .digest('hex')
    .slice(0, 16)
}

/** The engine distribution (`dist/<version>`) and the bundled runtime the launcher starts. */
export interface EnginePaths {
  readonly engineRoot: string
  readonly runtimeRoot: string
}

/**
 * The paths of the engine whose launcher is `ensoExecutable` (`<root>/dist/<version>/bin/enso`):
 * `engineRoot` is the real path of `dist/<version>`, `runtimeRoot` the one directory under
 * `<root>/runtime/`. `undefined` when there is no runtime (a development build runs the JVM it
 * finds, so it gets no cache).
 */
export async function enginePaths(ensoExecutable: string): Promise<EnginePaths | undefined> {
  return enginePathsSync(ensoExecutable)
}

/** {@link enginePaths}, for a caller that cannot wait (the runner spawns synchronously). */
export function enginePathsSync(ensoExecutable: string): EnginePaths | undefined {
  let engineRoot: string
  try {
    engineRoot = fsSync.realpathSync(path.dirname(path.dirname(ensoExecutable)))
  } catch {
    return undefined
  }
  const runtimes = path.join(engineRoot, '..', '..', 'runtime')
  let entries: fsSync.Dirent[]
  try {
    entries = fsSync.readdirSync(runtimes, { withFileTypes: true })
  } catch {
    return undefined
  }
  const directories = entries.filter((entry) => entry.isDirectory())
  if (directories.length !== 1) return undefined
  return { engineRoot, runtimeRoot: path.resolve(runtimes, directories[0]!.name) }
}

/** The text of the engine's `jvm.options` (`<engineRoot>/jvm.options`), `''` when it has none. */
export async function readJvmOptionsText(engineRoot: string): Promise<string> {
  return readJvmOptionsTextSync(engineRoot)
}

/** {@link readJvmOptionsText}, for a caller that cannot wait. */
export function readJvmOptionsTextSync(engineRoot: string): string {
  try {
    return fsSync.readFileSync(path.join(engineRoot, 'jvm.options'), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Whether macOS runs the app from a random App Translocation path: a cache trained there would be
 * useless at the next launch, so none is trained or used.
 */
export function isTranslocated(engineRoot: string): boolean {
  // macOS only; either separator, so that the tests run on every host.
  return /[\\/]AppTranslocation[\\/]/.test(engineRoot)
}

/**
 * Whether the engine runs from a Linux AppImage's mount (`$TMPDIR/.mount_<random>/`), or from
 * the directory `--appimage-extract-and-run` extracts it to (`$TMPDIR/appimage_extracted_<hash>/`,
 * deleted when the app exits); both move or vanish between launches. A cache trained there would be
 * useless at the next launch, so none is trained or used. The IDE runs the AppImage's engine from a copy instead (`stableEngine.ts`), from the
 * second launch of a build.
 */
export function isAppImageMount(engineRoot: string): boolean {
  // Either separator, so that the tests run on every host.
  return /[\\/](?:\.mount_|appimage_extracted_)[^\\/]+[\\/]/.test(engineRoot)
}
