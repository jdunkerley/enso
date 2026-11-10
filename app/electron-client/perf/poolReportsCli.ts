/**
 * @file Command line for `poolReports.ts`: pools the `open-time.json` of each round's directory.
 *
 * Usage: corepack pnpm --filter enso exec vite-node perf/poolReportsCli.ts -- <round dir>...
 */
import fs from 'node:fs'
import path from 'node:path'
import type { OpenTimeReport } from './openTimeReport'
import { pooledMarkdown, poolReports } from './poolReports'

const dirs = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === '--'))
if (dirs.length === 0) {
  console.error('Usage: vite-node perf/poolReportsCli.ts -- <round dir>...')
  process.exitCode = 2
} else {
  const reports = dirs.map(
    (dir) =>
      JSON.parse(fs.readFileSync(path.join(dir, 'open-time.json'), 'utf8')) as OpenTimeReport,
  )
  console.log(pooledMarkdown(poolReports(reports)))
}
