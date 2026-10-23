/**
 * @file `ide-build`: packages the IDE from `dist/gui` and `dist/backend` into `dist/ide`, as
 * `./run ide build --backend-source local --gui-source local` did. The version is the `version`
 * command's (so `ENSO_VERSION` overrides it). Pass `--sign` to sign (release only).
 *
 *     corepack pnpm --filter build-scripts run ide-build
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
} from '../ide-build/ideBuild.ts'
import { capture, commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { repositoryVersions } from '../version/repository.ts'

/** Blocks for `ms` milliseconds. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** `corepack pnpm install`, retried five times, as `./run` retried it. */
function installWorkspace(): void {
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
function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA ?? ''
  if (fromCi !== '') return fromCi
  const head = capture('git', ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) throw new Error(`\`git rev-parse --verify HEAD\` failed: ${head.stderr}`)
  return head.stdout.trim()
}

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { sign: { type: 'boolean', default: false } },
  })
  const { version } = repositoryVersions()
  const dist = (name: string) => path.join(REPO_ROOT, 'dist', name)
  const backendDir = dist('backend')
  console.log(`Packaging IDE ${version.text} with engine ${latestBundledEngine(backendDir)}.`)
  installWorkspace()
  const variables = ideBuildVariables(
    {
      version,
      commitHash: commitHash(),
      os: targetOs(process.platform),
      sign: values.sign,
      guiDir: dist('gui'),
      ideDir: dist('ide'),
      backendDir,
    },
    process.env,
  )
  for (const step of packagingSteps(variables, process.env)) {
    const status = runInherited('corepack', ['pnpm', ...step.args], { env: step.env })
    if (status !== 0) {
      throw new Error(`\`corepack pnpm ${step.args.join(' ')}\` failed (exit ${status}).`)
    }
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
