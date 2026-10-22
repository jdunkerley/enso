/**
 * @file `toolchain-check`: reports whether the installed GraalVM, sbt, flatc, Node, pnpm, Rust and
 * GraalPy match the pinned versions, with an install hint for each that does not. Exits 1 when a
 * required tool is missing or at the wrong version.
 *
 *     corepack pnpm --silent --filter build-scripts run toolchain-check
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { capture, REPO_ROOT } from '../lib/repo.ts'
import { evaluate, readPins, report, toolsToCheck } from '../toolchain/check.ts'

try {
  const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')
  const pins = readPins({
    buildConfig: read('build-config.yaml'),
    nodeVersion: read('.node-version'),
    packageJson: read('package.json'),
    rustToolchain: read('rust-toolchain.toml'),
  })
  const results = toolsToCheck(pins).map((tool) => {
    const ran = capture(tool.program, tool.args)
    return evaluate(tool, ran.status, `${ran.stdout}\n${ran.stderr}`)
  })
  for (const line of report(results)) console.log(line)
  if (results.some((result) => result.fails)) process.exitCode = 1
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
