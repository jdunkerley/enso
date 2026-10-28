/**
 * @file `ide-build`: what the retired build CLI's `ide build --backend-source local --gui-source
 * local` did in CI (the retired build CLI's `web.rs` `IdeDesktop::dist`), minus what nothing used.
 * With the GUI in `dist/gui` and the engine bundle in `dist/backend`, it installs the workspace,
 * then runs `build:ide` and `dist:ide` with the variables electron-builder reads, and leaves the
 * installer (and its `.sha256`, which electron-builder's `computeHashes` hook writes) in
 * `dist/ide`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { maxVersion, parseVersion, type Version } from '../version/version.ts'

/** The installer's platform. */
export type TargetOs = 'linux' | 'windows' | 'macos'

/** The installer's platform for a Node platform. */
export function targetOs(platform: NodeJS.Platform): TargetOs {
  if (platform === 'linux') return 'linux'
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  throw new Error(`The IDE is not packaged for ${platform}.`)
}

/**
 * `ENSO_IDE_UPDATES`: `manual` for a dev version (its prerelease contains `dev`) and for an
 * unsigned macOS build, `auto` otherwise. Ported from the retired build CLI's `update_mode`.
 */
export function updateMode(version: Version, os: TargetOs, macSigned: boolean): 'auto' | 'manual' {
  return version.pre.includes('dev') || (os === 'macos' && !macSigned) ? 'manual' : 'auto'
}

/**
 * The code-signing variables electron-builder reads. An empty one (a fork, or a missing secret)
 * would make it try to sign with nothing, so `dist:ide` runs without those that are empty
 * (`RemoveEmptyCscEnvVars`).
 */
export const CSC_VARIABLES = [
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLEID',
  'APPLEIDPASS',
  'APPLETEAMID',
] as const

/** `env` without the code-signing variables that are set to the empty string. */
export function withoutEmptyCscVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env }
  for (const name of CSC_VARIABLES) {
    if (result[name] === '') delete result[name]
  }
  return result
}

/**
 * The newest engine in a backend bundle: the greatest version-named directory under
 * `<backend>/dist`. A bundle without one is an error, the only check the retired build CLI made of
 * it.
 */
export function latestBundledEngine(backendDir: string): string {
  const distDir = path.join(backendDir, 'dist')
  const versions: Version[] = []
  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      const parsed = parseVersion(name)
      if (parsed != null && statSync(path.join(distDir, name)).isDirectory()) versions.push(parsed)
    }
  }
  const latest = maxVersion(versions)
  if (latest == null) {
    throw new Error(`Backend at ${backendDir} does not contain any Enso Engine packages.`)
  }
  return latest.text
}

/** What the two pnpm children are given. */
export interface IdeBuildInputs {
  readonly version: Version
  readonly commitHash: string
  readonly os: TargetOs
  readonly sign: boolean
  readonly guiDir: string
  readonly ideDir: string
  readonly backendDir: string
}

/**
 * The variables `build:ide` and `dist:ide` get on top of the inherited environment. `ENSO_BUILD_SIGN`
 * is always set: electron-builder's configuration defaults it to `true`.
 */
export function ideBuildVariables(
  inputs: IdeBuildInputs,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const macSigned = inputs.sign && (env.CSC_LINK ?? '') !== ''
  return {
    ENSO_IDE_VERSION: inputs.version.text,
    ENSO_IDE_COMMIT_HASH: inputs.commitHash,
    ENSO_IDE_UPDATES: updateMode(inputs.version, inputs.os, macSigned),
    ENSO_BUILD_GUI: inputs.guiDir,
    ENSO_BUILD_IDE: inputs.ideDir,
    ENSO_BUILD_BACKEND: inputs.backendDir,
    ENSO_BUILD_SIGN: String(inputs.sign),
  }
}

/** One `corepack pnpm …` call of the build. */
export interface PnpmStep {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/** The two packaging calls, in order: `build:ide`, then `dist:ide` without empty signing variables. */
export function packagingSteps(
  variables: Record<string, string>,
  env: NodeJS.ProcessEnv,
): PnpmStep[] {
  const childEnv = { ...env, ...variables }
  return [
    { args: ['run', 'build:ide'], env: childEnv },
    { args: ['run', 'dist:ide'], env: withoutEmptyCscVariables(childEnv) },
  ]
}

/**
 * The delays before each retry of `pnpm install`: 0.5 s, growing by half, at most 10 s
 * (the retired build CLI's `retry`).
 */
export function retryDelays(retries: number): number[] {
  return Array.from({ length: retries }, (_, attempt) => Math.min(500 * 1.5 ** attempt, 10_000))
}
