/**
 * @file `ide-local`'s inputs: the IDE built from this checkout's sources, start to finish. The
 * engine bundle comes from sbt's `buildEngineBundle`, the GUI from `build:gui`, and both are copied
 * into `dist/` afresh before the packaging, so an installer never carries an engine or a GUI left
 * over from an earlier build.
 */
import path from 'node:path'
import { archName, osName } from '../lib/engine.ts'
import type { Versions } from '../version/version.ts'

/** The sbt command that builds the engine bundle. No `clean`: a local build is incremental. */
export const ENGINE_BUNDLE_COMMAND = 'buildEngineBundle'

/**
 * The bundle `buildEngineBundle` leaves (`EngineBundle.root` in `project/EngineBundle.scala`):
 * `built-distribution/engine-bundle-<version>-<os>-<arch>/enso`.
 */
export function engineBundleDir(
  repoRoot: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const triple = `${version}-${osName(platform)}-${archName(arch)}`
  return path.join(repoRoot, 'built-distribution', `engine-bundle-${triple}`, 'enso')
}

/**
 * sbt's environment for the bundle: the version triple, as the `version` command publishes it, and
 * `ENSO_LAUNCHER=native` (what the IDE ships, and CI's packaging passes) unless the caller set one.
 */
export function engineBuildEnv(env: NodeJS.ProcessEnv, versions: Versions): NodeJS.ProcessEnv {
  const launcher = env.ENSO_LAUNCHER ?? ''
  return {
    ...env,
    ENSO_VERSION: versions.version.text,
    ENSO_EDITION: versions.version.text,
    ENSO_RELEASE_MODE: String(versions.releaseMode),
    ENSO_LAUNCHER: launcher !== '' ? launcher : 'native',
  }
}

/**
 * Why the engine bundle cannot be built in this environment, or `null`. On Windows the native
 * images link with MSVC, and `MsvcRuntime` copies the runtime DLLs from `VCToolsRedistDir`, which
 * only a Visual Studio developer environment sets.
 */
export function msvcProblem(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform !== 'win32' || (env.VCToolsRedistDir ?? '') !== '') return null
  return (
    'VCToolsRedistDir is not set. Run this from a Visual Studio "Developer PowerShell" or ' +
    '"x64 Native Tools Command Prompt" (or after vcvars64.bat): the engine bundle\'s native images ' +
    'need the MSVC environment.'
  )
}

/** The GUI build: `build:gui` in a Vite mode (CI builds `production`). */
export function guiBuildArgs(mode: string): string[] {
  return ['run', 'build:gui', `--mode=${mode}`]
}

/** The GUI build's environment: the version and commit it shows, as `ide-build` gives the IDE. */
export function guiBuildEnv(
  env: NodeJS.ProcessEnv,
  version: string,
  commitHash: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ENSO_IDE_VERSION: version,
    ENSO_IDE_COMMIT_HASH: commitHash,
  }
}
