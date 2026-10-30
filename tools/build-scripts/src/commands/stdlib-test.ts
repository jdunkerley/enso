/**
 * @file `stdlib-test <suite> [--only A_Tests,B_Tests] [--no-clean] [--dry-run]`: runs a
 * standard-library test suite against the engine package in `built-distribution/` (with
 * `ENSO_VERSION`, that version's). For the databases, export `ENSO_POSTGRES_*` and
 * `ENSO_SQLSERVER_*` (CI's service containers do); without them those groups are skipped.
 * `ENSO_TEST_GROUP_FILTER` (one project only) runs the test groups whose names match; a run in
 * which it ran no test fails.
 *
 *     corepack pnpm --filter build-scripts run stdlib-test -- standard-library-in-native
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { findEnginePackage } from '../lib/engine.ts'
import { commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { startHttpbin } from '../stdlib-test/httpbin.ts'
import { runStdlibTests } from '../stdlib-test/run.ts'
import { parseOnly } from '../stdlib-test/suites.ts'

/** Every `bench-report.xml` under `dir`, skipping dependencies and VCS data. */
function benchReports(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') found.push(...benchReports(full))
    } else if (entry.name === 'bench-report.xml') {
      found.push(full)
    }
  }
  return found
}

try {
  const { values, positionals } = parseArgs({
    args: commandArguments(),
    allowPositionals: true,
    options: {
      only: { type: 'string' },
      'no-clean': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const [suite] = positionals
  if (suite == null || positionals.length !== 1) {
    throw new Error('Usage: stdlib-test <suite> [--only A_Tests,B_Tests] [--no-clean] [--dry-run]')
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY ?? ''
  process.exitCode = await runStdlibTests(
    {
      suite,
      ...(values.only != null ? { only: parseOnly(values.only) } : {}),
      clean: !values['no-clean'],
      dryRun: values['dry-run'],
    },
    {
      repoRoot: REPO_ROOT,
      platform: process.platform,
      env: process.env,
      home: homedir(),
      enginePackage: findEnginePackage(REPO_ROOT, process.env.ENSO_VERSION),
      exists: existsSync,
      startHttpbin: () => startHttpbin(REPO_ROOT, process.env),
      runProject: (file, args, env) => runInherited(file, args, { env }),
      remove: (target) => rmSync(target, { recursive: true, force: true }),
      benchReports: () => benchReports(REPO_ROOT),
      resetDir: (dir) => {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
      },
      appendSummary: (lines) => {
        if (summaryFile !== '') appendFileSync(summaryFile, `${lines.join('\n')}\n`)
      },
      log: (line) => console.log(line),
    },
  )
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
