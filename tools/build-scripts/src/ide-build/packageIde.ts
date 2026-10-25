/**
 * @file Packaging the IDE from `dist/gui` and `dist/backend` into `dist/ide`: the step that
 * `ide-build` (CI) and `ide-local` (a developer's whole build) share.
 */
import path from 'node:path'
import { capture, REPO_ROOT, runInherited } from '../lib/repo.ts'
import type { Version } from '../version/version.ts'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
} from './ideBuild.ts'

/** `dist/<name>` under the repository: the packaging's inputs (`gui`, `backend`) and output (`ide`). */
export function distDir(name: 'gui' | 'backend' | 'ide'): string {
  return path.join(REPO_ROOT, 'dist', name)
}

/** Blocks for `ms` milliseconds. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** `corepack pnpm install`, retried five times. */
export function installWorkspace(): void {
  const delays = retryDelays(5)
  for (let attempt = 0; ; attempt++) {
    const status = runInherited('corepack', ['pnpm', 'install'])
    if (status === 0) return
    const delay = delays[attempt]
    if (delay == null) throw new Error(`\`corepack pnpm install\` failed (exit ${status}).`)
    console.log(`\`corepack pnpm install\` failed (exit ${status}); retrying in ${delay} ms.`)
    sleep(delay)
  }
}

/** `GITHUB_SHA` in CI, else `HEAD`. */
export function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA ?? ''
  if (fromCi !== '') return fromCi
  const head = capture('git', ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) throw new Error(`\`git rev-parse --verify HEAD\` failed: ${head.stderr}`)
  return head.stdout.trim()
}

/** How {@link packageIde} runs. */
export interface PackageOptions {
  readonly version: Version
  /** Sign the installer (release only). */
  readonly sign: boolean
  /** Run `corepack pnpm install` first; a caller that has just installed passes `false`. */
  readonly install: boolean
}

/**
 * Runs `build:ide` and `dist:ide` over `dist/gui` and `dist/backend`, with the variables
 * electron-builder reads, leaving the installer and its `.sha256` in `dist/ide`. Throws when a step
 * fails, or when `dist/backend` holds no engine.
 */
export function packageIde(options: PackageOptions): void {
  const backendDir = distDir('backend')
  console.log(
    `Packaging IDE ${options.version.text} with engine ${latestBundledEngine(backendDir)}.`,
  )
  if (options.install) installWorkspace()
  const variables = ideBuildVariables(
    {
      version: options.version,
      commitHash: commitHash(),
      os: targetOs(process.platform),
      sign: options.sign,
      guiDir: distDir('gui'),
      ideDir: distDir('ide'),
      backendDir,
    },
    process.env,
  )
  for (const step of packagingSteps(variables, process.env)) {
    const status = runInherited('corepack', ['pnpm', ...step.args], {
      env: step.env,
    })
    if (status !== 0) {
      throw new Error(`\`corepack pnpm ${step.args.join(' ')}\` failed (exit ${status}).`)
    }
  }
}
