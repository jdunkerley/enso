/**
 * @file Where the JDK AOT cache lives, when it trains, and which engine a Linux AppImage runs: kept
 * free of `electron` so it can be tested.
 */
import * as path from 'node:path'
import { readyStableEngine, stableEnginePath } from 'project-manager-shim/jvmAot'
import { resolveDefaultEngineMode, type EngineSettings } from 'project-manager-shim/projectService'

/** `ENSO_JVM_AOT_DIR` when it is set and not empty, else `<userData>/jvm-aot`. */
export function jvmAotRootDirectory(
  env: Readonly<Record<string, string | undefined>>,
  userData: string,
): string {
  return env.ENSO_JVM_AOT_DIR || path.join(userData, 'jvm-aot')
}

/**
 * Whether the JVM is the resolved default engine (`--engine-mode`, `ENSO_ENGINE_MODE`, then the
 * built-in default): the AOT cache trains only then. A project's own `jvm:` key does not count.
 */
export function isJvmDefaultEngine(
  engine: EngineSettings | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    resolveDefaultEngineMode({ option: engine?.option, environment: env.ENSO_ENGINE_MODE }).mode ===
    'jvm'
  )
}

/** What a Linux AppImage does about its engine at launch ({@link appImageEngine}). */
export interface AppImageEngine {
  /** The copy's launcher, for the project service and the AOT cache, when a complete copy exists. */
  readonly enginePath?: string
  /** Makes the copy, used from the next launch on; called once the window is up. */
  readonly startCopy?: () => Promise<string>
}

/**
 * Under a Linux AppImage (`APPIMAGE` set), with the JVM as the default engine (the AOT cache is
 * what the copy is for) and no `ENSO_ENGINE_PATH` of the user's, the engine to run is a copy of
 * the bundled one at `<userData>/engine/<version>/`, whose path, unlike the AppImage's mount, is
 * the same at every launch (`project-manager-shim/jvmAot`, `stableEngine.ts`). When there is no
 * complete copy of this build yet, this launch runs the mounted engine (without an AOT cache) and
 * `startCopy` makes the copy in the background, so the window does not wait for 1.8 GB.
 *
 * The path is returned, never put in the environment: an in-app update relaunches the new
 * AppImage with this process's environment, and the new version would run this one's copy.
 */
export async function appImageEngine(
  env: Readonly<Record<string, string | undefined>>,
  settings: { readonly resourcesPath: string; readonly userData: string; readonly version: string },
  engine: EngineSettings | undefined,
): Promise<AppImageEngine> {
  if (!env.APPIMAGE || env.ENSO_ENGINE_PATH || !isJvmDefaultEngine(engine, env)) return {}
  const options = {
    userData: settings.userData,
    version: settings.version,
    bundleRoot: path.join(settings.resourcesPath, 'enso'),
  }
  const enginePath = await readyStableEngine(options)
  if (enginePath != null) return { enginePath }
  return { startCopy: () => stableEnginePath(options) }
}
