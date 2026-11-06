/**
 * @file The JVM-by-default gate (stage 2 of the plan, `docs/superpowers/specs/2026-11-03-jvm-by-default-design.md`):
 * the median of three per-dispatch ratios of the JVM's open time to native's, for `welcomeShown`
 * (welcome template) and `libraryShown` (`image` template). Both at most 1.5 passes; either over
 * 1.6 fails; between is for the owner. Linux and macOS are reported, not gated.
 *
 * ```
 * corepack pnpm --filter enso exec vite-node perf/gate.ts -- <dir>...
 * ```
 *
 * where each `<dir>` is one dispatch's download: `<dir>/<os>/welcome/open-time.json` and
 * `<dir>/<os>/image/open-time.json` (`gh run download <id> --name open-perf-<os> --dir <dir>/<os>`,
 * from a dispatch with `open_perf_template=welcome,image`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { median, type OpenTimeReport, type OpenTimes } from './openTimeReport'

/** The two phases the gate reads. */
export type GatePhase = 'welcomeShown' | 'libraryShown'
/** The engines that have a ratio against native. */
export type GateEngine = 'jvm' | 'jvm-first'

export type GateOutcome = 'pass' | 'owner decides' | 'fail'

/** Both at most this: pass. */
export const PASS_LIMIT = 1.5
/** Either over this: fail. */
export const FAIL_LIMIT = 1.6

/**
 * `phase` of one launch's first open. The `image` template's headline table is both marks at once
 * (`libraryShown` is taken at the instant of `welcomeShown`, `openProject` in `openTime.ts`), and
 * reports record the headline as `welcomeShown`, so `libraryShown` falls back to it.
 */
function firstOpenTime(first: OpenTimes, phase: GatePhase): number | undefined {
  const times = first as Partial<Record<GatePhase, number>>
  return times[phase] ?? (phase === 'libraryShown' ? times.welcomeShown : undefined)
}

function engineMedian(
  report: OpenTimeReport,
  engine: GateEngine | 'native',
  phase: GatePhase,
): number | undefined {
  return median(
    report.runs
      .filter((r) => r.engine === engine)
      .flatMap((r) => firstOpenTime(r.first, phase) ?? []),
  )
}

/**
 * The median first-open `phase` of `engine` over native's, within one report (one dispatch on one
 * platform); `undefined` when either has no launch that reached the phase.
 */
export function dispatchRatio(
  report: OpenTimeReport,
  phase: GatePhase,
  engine: GateEngine,
): number | undefined {
  const ours = engineMedian(report, engine, phase)
  const native = engineMedian(report, 'native', phase)
  return ours == null || native == null || native === 0 ? undefined : ours / native
}

/** The median of the per-dispatch ratios; `NaN` for none. */
export function gateValue(ratios: readonly number[]): number {
  return median(ratios) ?? Number.NaN
}

/** The spec's gate. A missing value (`NaN`) fails: no measurement is no pass. */
export function gateOutcome(welcome: number, library: number): GateOutcome {
  if (Number.isNaN(welcome) || Number.isNaN(library)) return 'fail'
  if (welcome > FAIL_LIMIT || library > FAIL_LIMIT) return 'fail'
  if (welcome <= PASS_LIMIT && library <= PASS_LIMIT) return 'pass'
  return 'owner decides'
}

type Ratios = Partial<Record<GateEngine, number>>

/** One dispatch's ratios on one platform. */
export interface DispatchRatios {
  readonly name: string
  readonly welcome: Ratios
  readonly library: Ratios
}

const ENGINES: readonly GateEngine[] = ['jvm', 'jvm-first']

const ratioCell = (value: number | undefined) =>
  value == null || Number.isNaN(value) ? '–' : value.toFixed(2)

/** A Markdown table: a row per dispatch, then the gate value (median) of each column. */
export function gateTable(dispatches: readonly DispatchRatios[]): string {
  const columns = [
    ...ENGINES.map((e) => ({ title: `welcome ${e}`, pick: (d: DispatchRatios) => d.welcome[e] })),
    ...ENGINES.map((e) => ({ title: `library ${e}`, pick: (d: DispatchRatios) => d.library[e] })),
  ]
  return [
    `| Dispatch | ${columns.map((c) => c.title).join(' | ')} |`,
    `| --- | ${columns.map(() => '---:').join(' | ')} |`,
    ...dispatches.map(
      (d) => `| ${d.name} | ${columns.map((c) => ratioCell(c.pick(d))).join(' | ')} |`,
    ),
    `| **Gate value** | ${columns
      .map((c) => `**${ratioCell(gateValue(dispatches.flatMap((d) => c.pick(d) ?? [])))}**`)
      .join(' | ')} |`,
  ].join('\n')
}

function readReport(file: string): OpenTimeReport | undefined {
  if (!fs.existsSync(file)) return undefined
  const report = JSON.parse(fs.readFileSync(file, 'utf8')) as OpenTimeReport
  if (report.version !== 1 || !Array.isArray(report.runs)) {
    throw new Error(`${file} is not an open-time report`)
  }
  return report
}

function ratiosOf(report: OpenTimeReport | undefined, phase: GatePhase): Ratios {
  if (report == null) return {}
  return Object.fromEntries(
    ENGINES.flatMap((engine) => {
      const ratio = dispatchRatio(report, phase, engine)
      return ratio == null ? [] : [[engine, ratio]]
    }),
  )
}

/** The platforms that any dispatch directory holds (`linux`, `macos`, `windows`), sorted. */
function platformsOf(dirs: readonly string[]): string[] {
  return [
    ...new Set(
      dirs.flatMap((dir) =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((e) => (e.isDirectory() ? e.name : [])),
      ),
    ),
  ].sort()
}

/** The report of every platform's dispatches: tables, and the outcome of Windows. */
export function gateReport(dirs: readonly string[]): string {
  const lines: string[] = []
  let windows: GateOutcome | undefined
  for (const platform of platformsOf(dirs)) {
    const dispatches: DispatchRatios[] = dirs.map((dir) => ({
      name: path.basename(path.resolve(dir)),
      welcome: ratiosOf(
        readReport(path.join(dir, platform, 'welcome', 'open-time.json')),
        'welcomeShown',
      ),
      library: ratiosOf(
        readReport(path.join(dir, platform, 'image', 'open-time.json')),
        'libraryShown',
      ),
    }))
    const pick = (phase: 'welcome' | 'library') =>
      gateValue(dispatches.flatMap((d) => d[phase].jvm ?? []))
    const welcome = pick('welcome')
    const library = pick('library')
    const outcome = gateOutcome(welcome, library)
    if (platform === 'windows') windows = outcome
    lines.push(
      `### ${platform}${platform === 'windows' ? ' (gated)' : ' (reported)'}`,
      '',
      'JVM open time over native, in the same dispatch (first open; `jvm` gates, `jvm-first` is reported).',
      '',
      gateTable(dispatches),
      '',
      `${platform}: welcome ${ratioCell(welcome)}, library ${ratioCell(library)}: ${outcome}.`,
      '',
    )
  }
  lines.push(
    windows == null ?
      'Outcome: no Windows data, so no outcome.'
    : `Outcome (Windows, \`jvm\`): **${windows}**.`,
  )
  return lines.join('\n')
}

function main(argv: readonly string[]) {
  const dirs = argv.filter((arg, i) => !(i === 0 && arg === '--'))
  if (dirs.length === 0) {
    console.error('Usage: vite-node perf/gate.ts -- <dispatch dir>...')
    process.exitCode = 2
    return
  }
  console.log(gateReport(dirs))
}

// Run as a script (vite-node), not when a test imports the functions above.
if (!process.env.VITEST) main(process.argv.slice(2))
