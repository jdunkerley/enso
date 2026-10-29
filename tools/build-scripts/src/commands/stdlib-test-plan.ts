/**
 * @file `stdlib-test-plan`: the standard-library test jobs of one platform, for the `stdlib-plan`
 * job of `engine-checks-platform.yml` (Note [Standard Library Test Selection] there). It reads
 * `STDLIB_SUITES` (the platform's `stdlib-suites` JSON), `CHANGED_FILES` (space-separated) and
 * `STDLIB_SHARDS` (`false` keeps one job per suite), writes `matrix=<JSON>` to `GITHUB_OUTPUT`
 * (stdout when unset) and why to the job summary. Unless `GITHUB_EVENT_NAME` is `pull_request` and
 * `CHANGED_FILES` names a file, every project runs.
 *
 *     STDLIB_SUITES='[{"suite":"standard-library","title":"JVM","small-jdk":true}]' \
 *       corepack pnpm --silent --filter build-scripts run stdlib-test-plan
 */
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { REPO_ROOT } from '../lib/repo.ts'
import {
  changedFilesFor,
  planMatrix,
  planSummary,
  selectTestProjects,
  type StdlibTestMap,
  type SuiteEntry,
} from '../stdlib-test/plan.ts'
import { discoverProjects } from '../stdlib-test/suites.ts'

try {
  const env = process.env
  if ((env.STDLIB_SUITES ?? '').trim() === '')
    throw new Error(
      'STDLIB_SUITES is not set; pass the platform\'s stdlib-suites JSON ("[]" for none).',
    )
  const entries = JSON.parse(env.STDLIB_SUITES ?? '') as SuiteEntry[]
  const mapFile = path.join(REPO_ROOT, 'tools', 'ci', 'stdlib-test-map.yaml')
  const map = parse(readFileSync(mapFile, 'utf8')) as StdlibTestMap
  const changed = changedFilesFor(env.GITHUB_EVENT_NAME, env.CHANGED_FILES)
  const selection = selectTestProjects(map, changed)
  const projects = discoverProjects(path.join(REPO_ROOT, 'test'))
  const matrix = planMatrix(entries, map, projects, selection, env.STDLIB_SHARDS !== 'false')
  const output = `matrix=${JSON.stringify(matrix)}\n`
  const outputFile = env.GITHUB_OUTPUT ?? ''
  if (outputFile !== '') appendFileSync(outputFile, output)
  else process.stdout.write(output)
  const summaryFile = env.GITHUB_STEP_SUMMARY ?? ''
  if (summaryFile !== '')
    appendFileSync(summaryFile, `${planSummary(selection, matrix).join('\n')}\n`)
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
