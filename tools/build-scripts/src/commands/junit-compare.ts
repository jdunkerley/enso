/**
 * @file `junit-compare <old dir> <new dir> [--allow Project]...`: the side-by-side check for moving
 * the standard-library tests off `./run`. Both directories hold `<project>/JUnit.xml`. It prints a
 * Markdown table, and exits 1 when a project is missing on one side or its pass, fail or skip
 * count differs, unless the project is `--allow`ed (a documented flake).
 *
 *     corepack pnpm --silent --filter build-scripts run junit-compare -- old/ new/
 */
import { parseArgs } from 'node:util'
import { commandArguments } from '../lib/repo.ts'
import { compareRuns, comparisonMarkdown, readJUnitDir } from '../stdlib-test/junit.ts'

try {
  const { values, positionals } = parseArgs({
    args: commandArguments(),
    allowPositionals: true,
    options: { allow: { type: 'string', multiple: true, default: [] } },
  })
  const [oldDir, newDir] = positionals
  if (oldDir == null || newDir == null || positionals.length !== 2) {
    throw new Error('Usage: junit-compare <old dir> <new dir> [--allow Project]...')
  }
  const rows = compareRuns(readJUnitDir(oldDir), readJUnitDir(newDir))
  if (rows.length === 0) throw new Error(`No JUnit.xml under ${oldDir} or ${newDir}.`)
  for (const line of comparisonMarkdown(rows)) console.log(line)
  const failing = rows.filter((row) => !row.same && !values.allow.includes(row.project))
  if (failing.length > 0) {
    console.log(
      `\n${failing.length} project(s) differ: ${failing.map((r) => r.project).join(', ')}`,
    )
    process.exitCode = 1
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
