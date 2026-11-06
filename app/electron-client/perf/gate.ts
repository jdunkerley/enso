/**
 * @file The JVM-by-default gate (stage 2 of the plan, `docs/superpowers/specs/2026-11-03-jvm-by-default-design.md`):
 * the median of three per-dispatch ratios of the JVM's open time to native's, for `welcomeShown`
 * (welcome template) and `libraryShown` (`image` template). Both at most 1.5 passes; either over
 * 1.6 fails; between is for the owner. Only Windows is gated: Linux and macOS are reported.
 *
 * ```
 * corepack pnpm --filter enso exec vite-node perf/gate.ts -- <dir>...
 * ```
 *
 * where each `<dir>` is one dispatch's download: `<dir>/<os>/welcome/open-time.json` and
 * `<dir>/<os>/image/open-time.json` (`gh run download <id> --name open-perf-<os> --dir <dir>/<os>`,
 * from a dispatch with `open_perf_template=welcome,image`).
 *
 * Nothing is dropped quietly (Note [The Gate Drops Nothing]): every cell prints its launch counts,
 * a launch that never reached the phase counts against the engine, a cell with fewer than
 * `MIN_LAUNCHES` successes is incomplete, and without three complete dispatches there is no
 * outcome ("insufficient data"). With more than three, the latest three complete ones (the last
 * `<dir>`s given) are the gate; an incomplete one is set aside, still shown in the table.
 */
import fs from 'node:fs'
import path from 'node:path'
import { median, type OpenTimeReport, type OpenTimes } from './openTimeReport'

/** The two phases the gate reads. */
export type GatePhase = 'welcomeShown' | 'libraryShown'
/** The engines that have a ratio against native. */
export type GateEngine = 'jvm' | 'jvm-first'

export type GateOutcome = 'pass' | 'owner decides' | 'fail'
export type GateDecision = GateOutcome | 'insufficient data'

/** Both at most this: pass. */
export const PASS_LIMIT = 1.5
/** Either over this: fail. */
export const FAIL_LIMIT = 1.6
/** A cell with fewer successful launches than this is incomplete. */
export const MIN_LAUNCHES = 3
/** The dispatches a gate value is the median of. */
export const GATE_DISPATCHES = 3

/* Note [The Gate Drops Nothing]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A JVM launch that fails before the headline is usually a timeout, the slowest kind of launch;
 * leaving it out of the median makes the JVM look faster, and a dispatch that is missing makes
 * "the median of three" a median of two. So: a JVM launch that never reached the phase ranks above
 * every success (infinitely slow) and a native one below every success (0), both the conservative
 * way for the ratio; each cell shows `successes/launches` for both engines; a cell under
 * `MIN_LAUNCHES` successes is incomplete; and the outcome needs `GATE_DISPATCHES` dispatches whose
 * Windows `jvm` cells are all complete (the latest such; an incomplete one is shown, not used).
 * Gate dispatches run with 5 launches per cell: with 3, one hang already makes a cell incomplete.
 */

/**
 * `phase` of one launch's first open. The `image` template's headline table is both marks at once
 * (`libraryShown` is taken at the instant of `welcomeShown`, `openProject` in `openTime.ts`), and
 * reports record the headline as `welcomeShown`, so for a report of the `image` project
 * `libraryShown` falls back to it. For any other report it does not: a welcome report filed under
 * `image` by mistake gives no library figure.
 */
function firstOpenTime(
  report: OpenTimeReport,
  first: OpenTimes,
  phase: GatePhase,
): number | undefined {
  const times = first as Partial<Record<GatePhase, number>>
  if (times[phase] != null) return times[phase]
  return phase === 'libraryShown' && report.project === 'image' ? times.welcomeShown : undefined
}

/** Launches of one engine in a report: how many reached `phase`, out of how many. */
export interface LaunchCount {
  readonly ok: number
  readonly total: number
}

function launchesOf(report: OpenTimeReport, engine: GateEngine | 'native') {
  return report.runs.filter((r) => r.engine === engine)
}

/** The successes out of the launches of `engine` for `phase`. */
export function launchCount(
  report: OpenTimeReport,
  engine: GateEngine | 'native',
  phase: GatePhase,
): LaunchCount {
  const runs = launchesOf(report, engine)
  return {
    ok: runs.filter((r) => firstOpenTime(report, r.first, phase) != null).length,
    total: runs.length,
  }
}

/** The median with a failed launch ranked as `failure` (Note [The Gate Drops Nothing]). */
function engineMedian(
  report: OpenTimeReport,
  engine: GateEngine | 'native',
  phase: GatePhase,
): number | undefined {
  const failure = engine === 'native' ? 0 : Number.POSITIVE_INFINITY
  return median(
    launchesOf(report, engine).map((r) => firstOpenTime(report, r.first, phase) ?? failure),
  )
}

/**
 * The median first-open `phase` of `engine` over native's, within one report (one dispatch on one
 * platform), failed launches ranked against the engine; `undefined` when either has no launch at
 * all. Infinite when the JVM's median launch failed.
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

/** A value as the table prints it: two decimals. The outcome is decided on this, not on a rounding of its own. */
export const printed = (value: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : value

/**
 * The spec's gate, decided on the values as printed (two decimals). A missing value (`NaN`) fails:
 * no measurement is no pass.
 */
export function gateOutcome(welcomeValue: number, libraryValue: number): GateOutcome {
  const welcome = printed(welcomeValue)
  const library = printed(libraryValue)
  if (Number.isNaN(welcome) || Number.isNaN(library)) return 'fail'
  if (welcome > FAIL_LIMIT || library > FAIL_LIMIT) return 'fail'
  if (welcome <= PASS_LIMIT && library <= PASS_LIMIT) return 'pass'
  return 'owner decides'
}

/** One engine's ratio in one dispatch, with the launches behind it. */
export interface GateCell {
  readonly ratio?: number
  readonly engine: LaunchCount
  readonly native: LaunchCount
}

export const isComplete = (cell: GateCell | undefined): cell is GateCell =>
  cell != null &&
  cell.ratio != null &&
  cell.engine.ok >= MIN_LAUNCHES &&
  cell.native.ok >= MIN_LAUNCHES

/** The cell of `report` for `phase` and `engine`. */
export function gateCell(report: OpenTimeReport, phase: GatePhase, engine: GateEngine): GateCell {
  const ratio = dispatchRatio(report, phase, engine)
  return {
    ...(ratio == null ? {} : { ratio }),
    engine: launchCount(report, engine, phase),
    native: launchCount(report, 'native', phase),
  }
}

type Cells = Partial<Record<GateEngine, GateCell>>

/** One dispatch's cells on one platform. */
export interface DispatchRatios {
  readonly name: string
  readonly welcome: Cells
  readonly library: Cells
}

const ENGINES: readonly GateEngine[] = ['jvm', 'jvm-first']

function ratioText(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '–'
  return Number.isFinite(value) ? printed(value).toFixed(2) : 'inf (the median launch failed)'
}

function cellText(cell: GateCell | undefined): string {
  if (cell == null) return '– (no report)'
  const counts = `${cell.engine.ok}/${cell.engine.total} launches, native ${cell.native.ok}/${cell.native.total}`
  return `${ratioText(cell.ratio)} (${counts}${isComplete(cell) ? '' : '; incomplete'})`
}

/**
 * The dispatches a gate value is the median of: the latest `GATE_DISPATCHES` (the last ones given)
 * whose `jvm` welcome and library cells are both complete, so one incomplete dispatch among four
 * or more is set aside. `undefined` when fewer than that many are complete.
 */
export function selectGateDispatches(
  dispatches: readonly DispatchRatios[],
): DispatchRatios[] | undefined {
  const complete = dispatches.filter((d) => isComplete(d.welcome.jvm) && isComplete(d.library.jvm))
  return complete.length < GATE_DISPATCHES ? undefined : complete.slice(-GATE_DISPATCHES)
}

/**
 * A Markdown table: a row per dispatch, then the gate value (median) of each column over the
 * dispatches {@link selectGateDispatches} picks. Without enough complete dispatches the last row
 * is the plain median of whatever ratios exist, labelled as not a gate value.
 */
export function gateTable(dispatches: readonly DispatchRatios[]): string {
  const selected = selectGateDispatches(dispatches)
  const columns = [
    ...ENGINES.map((e) => ({ title: `welcome ${e}`, pick: (d: DispatchRatios) => d.welcome[e] })),
    ...ENGINES.map((e) => ({ title: `library ${e}`, pick: (d: DispatchRatios) => d.library[e] })),
  ]
  return [
    `| Dispatch | ${columns.map((c) => c.title).join(' | ')} |`,
    `| --- | ${columns.map(() => '---:').join(' | ')} |`,
    ...dispatches.map(
      (d) => `| ${d.name} | ${columns.map((c) => cellText(c.pick(d))).join(' | ')} |`,
    ),
    selected == null ?
      `| Median of the ratios above (not a gate value) | ${columns
        .map((c) => ratioText(gateValue(dispatches.flatMap((d) => c.pick(d)?.ratio ?? []))))
        .join(' | ')} |`
    : `| **Gate value** | ${columns
        .map((c) => `**${ratioText(gateValue(selected.flatMap((d) => c.pick(d)?.ratio ?? [])))}**`)
        .join(' | ')} |`,
  ].join('\n')
}

/**
 * The outcome for a platform's dispatches (the `jvm` cells): `insufficient data` unless
 * {@link selectGateDispatches} finds `GATE_DISPATCHES` dispatches whose welcome and library cells
 * are complete; with more, the latest complete ones decide.
 */
export function gateDecision(dispatches: readonly DispatchRatios[]): GateDecision {
  const selected = selectGateDispatches(dispatches)
  if (selected == null) return 'insufficient data'
  const value = (pick: (d: DispatchRatios) => GateCell | undefined) =>
    gateValue(selected.flatMap((d) => pick(d)?.ratio ?? []))
  return gateOutcome(
    value((d) => d.welcome.jvm),
    value((d) => d.library.jvm),
  )
}

function readReport(file: string): OpenTimeReport | undefined {
  if (!fs.existsSync(file)) return undefined
  const report = JSON.parse(fs.readFileSync(file, 'utf8')) as OpenTimeReport
  if (report.version !== 1 || !Array.isArray(report.runs)) {
    throw new Error(`${file} is not an open-time report`)
  }
  // `jvm` from before PR K had the harness's own AOT cache (`jvmAot`), or none: not what users get,
  // so not a gate number.
  if (report.shimAot == null && report.runs.some((r) => r.engine === 'jvm' && r.run > 0)) {
    throw new Error(
      `${file} has jvm launches but no shimAot: it was made by the harness before PR K (its own AOT cache), which is not what users get. Re-dispatch with a harness from PR K or later.`,
    )
  }
  return report
}

function cellsOf(report: OpenTimeReport | undefined, phase: GatePhase): Cells {
  if (report == null) return {}
  return Object.fromEntries(ENGINES.map((engine) => [engine, gateCell(report, phase, engine)]))
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

/** The report of every platform's dispatches: tables, and the outcome of Windows only. */
export function gateReport(dirs: readonly string[]): string {
  const lines: string[] = []
  let windows: GateDecision | undefined
  for (const platform of platformsOf(dirs)) {
    const dispatches: DispatchRatios[] = dirs.map((dir) => ({
      name: path.basename(path.resolve(dir)),
      welcome: cellsOf(
        readReport(path.join(dir, platform, 'welcome', 'open-time.json')),
        'welcomeShown',
      ),
      library: cellsOf(
        readReport(path.join(dir, platform, 'image', 'open-time.json')),
        'libraryShown',
      ),
    }))
    lines.push(
      `### ${platform}${platform === 'windows' ? ' (gated)' : ' (informational, not gated)'}`,
      '',
      'JVM open time over native, in the same dispatch (first open; a launch that never reached the phase counts against the JVM; `jvm` gates, `jvm-first` is reported).',
      '',
      gateTable(dispatches),
      '',
    )
    if (platform === 'windows') {
      windows = gateDecision(dispatches)
      lines.push(`windows: ${windows}.`, '')
    }
  }
  lines.push(
    windows == null ? 'Outcome: no Windows data, so no outcome (insufficient data).'
    : windows === 'insufficient data' ?
      `Outcome (Windows, \`jvm\`): **insufficient data** (needs ${GATE_DISPATCHES} dispatches, each with at least ${MIN_LAUNCHES} successful launches of both engines in every Windows cell).`
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
  try {
    console.log(gateReport(dirs))
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e))
    process.exitCode = 1
  }
}

// Run as a script (vite-node), not when a test imports the functions above.
if (!process.env.VITEST) main(process.argv.slice(2))
