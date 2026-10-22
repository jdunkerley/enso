/**
 * @file `stdlib-api-check`: regenerates each standard library's API docs with the built engine and
 * fails when they differ from the committed ones. CI sets `ENSO_VERSION` to the build job's version
 * (as the Enso lint does); locally, without it, the only package in `built-distribution/` is used.
 *
 *     corepack pnpm --filter build-scripts run stdlib-api-check
 */
import { ensoBinary, findEnginePackage } from '../lib/engine.ts'
import { capture, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { runApiCheck } from '../stdlib-api-check/apiCheck.ts'

try {
  const enginePackage = findEnginePackage(REPO_ROOT, process.env.ENSO_VERSION)
  const enso = ensoBinary(enginePackage.dir, process.platform)
  const ok = runApiCheck({
    repoRoot: REPO_ROOT,
    enginePackage,
    enso,
    runEnso: (args) => runInherited(enso, args),
    diff: (oldDir, newDir) =>
      capture('git', ['diff', '--no-index', oldDir, newDir, '--exit-code', '--no-ext-diff']),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
  if (!ok) process.exitCode = 1
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
