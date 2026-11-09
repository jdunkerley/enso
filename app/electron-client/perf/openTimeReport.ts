/**
 * @file The pure logic of the open-time harness (`openTime.ts`): reading the Language Server's
 * log, turning the driver's marks into phase times, and summarising, comparing and printing
 * them. See `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`, section 2.
 */

/** The phases of an open, in order, each named after the mark that ends it. */
export const PHASES = [
  'engineUp',
  'lsReady',
  'openAnswered',
  'guiConnected',
  'firstNode',
  'firstExecution',
  'welcomeShown',
] as const
export type Phase = (typeof PHASES)[number]

/** Marks taken after the welcome table, which the headline does not include. */
export const EXTRAS = ['cbEntries', 'formatWidget', 'dropdownItems'] as const
export type Extra = (typeof EXTRAS)[number]

export const LABELS: Record<Phase | Extra, string> = {
  engineUp: 'Engine process running',
  lsReady: 'Language server ready',
  openAnswered: '`project/open` answered',
  guiConnected: 'GUI opens the ydoc socket',
  firstNode: 'First graph node drawn',
  firstExecution: 'First execution done',
  welcomeShown: 'Welcome table visualisation shown',
  cbEntries: 'Component browser lists entries',
  formatWidget: '`format` widget shown',
  dropdownItems: '`format` dropdown lists items',
}

/** The headline: click to the welcome table, first (cold) open. */
export const HEADLINE: Phase = 'welcomeShown'

/** Milliseconds from the click on the project's row. */
export type OpenTimes = Partial<Record<Phase | Extra, number>>
/**
 * `native` is the native image. `jvm` is the engine as a user has it after the first open: the
 * bundled JDK with the shim's own AOT cache, trained before the measured launches. `jvm-first` is
 * a user's very first launch: the same, with the cache deleted before each launch.
 */
export type Engine =
  'native' | 'jvm' | 'jvm-first' | 'jvm-spare' | 'jvm-spare-early' | 'jvm-spare-abandon'

const ENGINES: readonly Engine[] = [
  'native',
  'jvm',
  'jvm-first',
  'jvm-spare',
  'jvm-spare-early',
  'jvm-spare-abandon',
]

/**
 * The JVM with its spare engine (`project-manager-shim/CLAUDE.md`, "Spare engine"): `jvm-spare`
 * opens once the spare is ready (at most 15 s on the dashboard); `jvm-spare-early` opens at once,
 * while it warms up; `jvm-spare-abandon` opens at once with the warm-up abandoned on the line.
 */
export function isSpareEngine(engine: Engine): boolean {
  return engine.startsWith('jvm-spare')
}
/** The first open of a launch is cold; the second opens another project in the same session. */
export type OpenTag = 'first' | 'second'

/** One timestamped event the driver saw (`k` its kind, `t` epoch ms), as in the spike's `marks.json`. */
export interface Mark {
  readonly k: string
  readonly t: number
  readonly u?: string
  readonly [extra: string]: unknown
}

/** The memory of the engine's processes and of the ydoc host, in kilobytes (`processRss.ts`). */
export interface RssSample {
  readonly engineKb: number
  readonly ydocKb: number
}

/** First open only: when the headline showed, and 30 s later. */
export interface RunRss {
  readonly atWelcome: RssSample
  readonly after30s: RssSample
}

export interface RunResult {
  readonly engine: Engine
  readonly run: number
  readonly first: OpenTimes
  readonly second: OpenTimes | null
  /** The phases and extras a successful launch did not record, first and second open together. */
  readonly notMeasured: readonly (Phase | Extra)[]
  readonly error?: string
  /** Sampled on the first open of the launch; absent when a sample failed. */
  readonly rss?: RunRss
  /** A spare engine launch's numbers (`spareRun`). */
  readonly spare?: SpareRun
  /** How many CPUs the IDE was pinned to (`cpuAffinity`), when it could be read. */
  readonly cpus?: number
}

/** What a launch's spare engines reported (their stderr, echoed by the shim). */
export interface SpareRun {
  /** Per spare, in start order: ms from its process start to `STANDBY READY`. */
  readonly readyMs: readonly number[]
  /** Per spare: the warm-up's own duration, and the process's CPU time at its end. */
  readonly warmUpMs: readonly number[]
  readonly cpuMs: readonly number[]
  /** The engine processes' memory (KiB) once the first spare was ready, before the first open. */
  readonly idleEngineKb?: number
  /** The opens that used a spare. */
  readonly used: readonly OpenTag[]
}

const READY_LINE = /STANDBY READY (-?\d+)/g
const WARM_UP_LINE = /standby: warm-up done in (\d+) ms, .*?, process CPU (-?\d+) ms/g

/** Each spare's `STANDBY READY` and warm-up line, in order. */
export function parseSpareOutput(stdout: string): Pick<SpareRun, 'readyMs' | 'warmUpMs' | 'cpuMs'> {
  const warmUps = [...stdout.matchAll(WARM_UP_LINE)]
  return {
    readyMs: [...stdout.matchAll(READY_LINE)].map((m) => Number(m[1])),
    warmUpMs: warmUps.map((m) => Number(m[1])),
    cpuMs: warmUps.map((m) => Number(m[2])),
  }
}

/** A spare launch's `SpareRun`: its output, its `spareIdle` RSS and its `<open>:spareUsed` marks. */
export function spareRun(stdout: string, marks: readonly Mark[]): SpareRun {
  const idle = marks.find((m) => m.k === 'rss' && m.phase === 'spareIdle')
  const idleKb =
    typeof idle?.engineKb === 'number' && idle.engineKb >= 0 ? idle.engineKb : undefined
  const used = (['first', 'second'] as const).filter((tag) =>
    marks.some((m) => m.k === `${tag}:spareUsed` && m.used === true),
  )
  return {
    ...parseSpareOutput(stdout),
    ...(idleKb != null ? { idleEngineKb: idleKb } : {}),
    used,
  }
}

/**
 * `core` when the new-project template imports only the core libraries (#482), `full` when it also
 * imports `Standard.AWS`, `other` for anything else (compared with nothing).
 */
export type Template = 'core' | 'full' | 'other'

/**
 * The shim's AOT cache (`project-manager-shim/jvmAot`) as the `jvm` runs had it: how long the
 * preparation launch took until `enso.aot` existed, its size, and the (1-based) launches after
 * which the cache was gone, which is what the shim does with a cache the JVM rejects.
 */
export interface ShimAot {
  readonly trainingMs: number
  readonly cacheBytes: number
  /** Launches after which the shim had deleted the cache. */
  readonly rejectedIn: readonly number[]
  /**
   * Launches whose JVMs loaded almost no classes from the cache (hsperf `sharedClasses`, see
   * {@link usedAotCache}): the cache was skipped, with or without a warning. Absent in older reports.
   */
  readonly uncachedIn?: readonly number[]
  /**
   * `jvm` launches whose cache use could not be checked: no hsperf counters of the launch's own
   * JVMs (see {@link usedAotCache}). Absent in older reports.
   */
  readonly uncheckedIn?: readonly number[]
}

/** A JVM that used the AOT cache loaded ~18,000 classes from it; one that did not, ~1,500. */
const CACHED_SHARED_CLASSES = 5000

/**
 * Whether a `jvm` launch's JVMs used the AOT cache, judged open by open on each open's own JVMs
 * (hsperf `jvm` marks): a JVM belongs to the launch when it started after the `launch` mark (a
 * file left by an earlier launch's JVM that is still alive is older), and to an open when it
 * started after that open's click and before the next open's. An open is cached when its JVM with
 * the most shared classes has at least {@link CACHED_SHARED_CLASSES}. The launch is `false` when
 * any open that has a JVM is not, so a cached second open cannot hide an uncached first; `undefined`
 * when no open has a JVM with counters (hsperf unavailable: `-XX:-UsePerfData`, an unreadable
 * temporary directory), which the caller records as unchecked.
 */
export function usedAotCache(marks: readonly Mark[]): boolean | undefined {
  const launch = marks.find((m) => m.k === 'launch')?.t ?? 0
  const clicks = (['first', 'second'] as const)
    .map((tag) => marks.find((m) => m.k === `${tag}:click`)?.t)
    .filter((t): t is number => t != null)
    .sort((a, b) => a - b)
  const jvms = marks.flatMap((m) =>
    m.k === 'jvm' && typeof m.sharedClasses === 'number' && typeof m.vmStart === 'number' ?
      [{ start: m.vmStart, shared: m.sharedClasses }]
    : [],
  )
  const verdicts: boolean[] = []
  clicks.forEach((click, i) => {
    const next = clicks[i + 1] ?? Number.POSITIVE_INFINITY
    const shared = jvms
      .filter((j) => j.start >= Math.max(launch, click) && j.start < next)
      .map((j) => j.shared)
    if (shared.length > 0) verdicts.push(Math.max(...shared) >= CACHED_SHARED_CLASSES)
  })
  return verdicts.length === 0 ? undefined : verdicts.every(Boolean)
}

export interface OpenTimeReport {
  readonly version: 1
  readonly platform: string
  readonly commit: string | null
  readonly template: Template
  /** Present when the report has `jvm` runs. */
  readonly shimAot?: ShimAot
  /**
   * The harness's own project (`--template`, `projectTemplates.ts`) when it was not the new-project
   * template; the headline is then that project's library table, not the welcome table.
   */
  readonly project?: string
  readonly runs: readonly RunResult[]
}

/** Whether `baseline` measured the same template, so that comparing with it means something. */
export function comparable(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
): baseline is OpenTimeReport {
  return baseline != null && baseline.template === report.template && report.template !== 'other'
}

/** A baseline: develop's report, or several of them (newest first); see Note [Noisy Medians]. */
export type Baseline = OpenTimeReport | readonly OpenTimeReport[] | undefined

/** The newest develop reports a comparison pools. */
export const BASELINE_RUNS = 5

/** The baseline reports that measured the same template as `report`, newest first. */
export function baselineReports(report: OpenTimeReport, baseline: Baseline): OpenTimeReport[] {
  const list =
    baseline == null ? []
    : 'runs' in baseline ? [baseline]
    : baseline
  return list.filter((b) => comparable(report, b))
}

export interface LsLogLine {
  readonly time: number
  readonly logger: string
  readonly message: string
}

const LS_LINE =
  /^\[(\w+)\] \[(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{3})\] \[([^\]]+)\] (.*)$/

/* Note [Language Server Log Times Are Local]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The Language Server's log pattern is `[%level] [%d{yyyy-MM-dd'T'HH:mm:ss.SSS}] [%logger] %msg%n`
 * (`lib/scala/logging-config/.../Appender.java`): logback writes the time in the JVM's default
 * time zone and no offset. So it is read as local time, on the same clock as `Date.now()`.
 */

/** One record of the Language Server's log, or `null` for a continuation line. */
export function parseLsLogLine(line: string): LsLogLine | null {
  const match = LS_LINE.exec(line)
  if (!match) return null
  const [, , y, mo, d, h, mi, s, ms, logger, message] = match
  return {
    time: new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!, +ms!).getTime(),
    logger: logger!,
    message: message!,
  }
}

/* Note [The GUI Is Connected When Its Socket Is Open]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Playwright's `websocket` event (the driver's `wsOpen` mark) fires once per connection attempt,
 * at a point that differs by platform: on Linux each refused attempt emitted one, on Windows the
 * event came at the open (a page hook saw `new WebSocket` ~500 ms earlier). When the ydoc port
 * refuses the GUI, y-websocket retries after 200, 400 and 800 ms (`2 ** failures * 100`), so on
 * Linux the first `wsOpen` is a refused attempt. On Linux, before the shim waited for the port, every open went so: four
 * `/project/index` sockets, the first ~50 ms after the answer and the one that opened ~1.4 s
 * later (PR #504's CI run), and `guiConnected` read the first. `guiConnected` is therefore the
 * first frame the page sends on the socket (`wsUp`): y-websocket sends its sync step 1 in
 * `onopen`, and a browser cannot send on a socket that is not open.
 */
const LS_MARKS = {
  lsReady: /^Started server at json/,
  firstExecution: /^The first execution finished\./,
} as const

/** The phase times of the open tagged `tag`, from the driver's marks and the open's log. */
export function openTimes(
  marks: readonly Mark[],
  tag: OpenTag,
  ls: readonly LsLogLine[] | undefined,
): OpenTimes {
  const click = marks.find((m) => m.k === `${tag}:click`)?.t
  if (click == null) return {}
  const rel = (t: number | undefined) => (t == null ? undefined : Math.round(t - click))
  const after = (pred: (m: Mark) => boolean) => marks.find((m) => m.t >= click && pred(m))?.t
  const logged = (pattern: RegExp) =>
    ls?.find((l) => l.time >= click && pattern.test(l.message))?.time
  const times: Partial<Record<Phase | Extra, number | undefined>> = {
    engineUp: rel(after((m) => m.k === 'engineStdout') ?? ls?.[0]?.time),
    lsReady: rel(logged(LS_MARKS.lsReady)),
    openAnswered: rel(after((m) => m.k === 'resp' && m.u === 'project/open')),
    // Note [The GUI Is Connected When Its Socket Is Open]
    guiConnected: rel(after((m) => m.k === 'wsUp' && (m.u ?? '').includes('/project/index'))),
    firstExecution: rel(logged(LS_MARKS.firstExecution)),
  }
  for (const key of ['firstNode', 'welcomeShown', ...EXTRAS] as const) {
    times[key] = rel(marks.find((m) => m.k === `${tag}:${key}`)?.t)
  }
  return Object.fromEntries(Object.entries(times).filter(([, v]) => v != null)) as OpenTimes
}

/** The phases and extras an open did not record. */
export function notMeasured(times: OpenTimes): (Phase | Extra)[] {
  return [...PHASES, ...EXTRAS].filter((key) => times[key] == null)
}

/** The median, the mean of the middle two for an even count; `undefined` for none. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface EngineSummary {
  readonly engine: Engine
  /** Launches whose first open reached the headline mark, out of `launches`. */
  readonly succeeded: number
  readonly launches: number
  readonly first: OpenTimes
  readonly second: OpenTimes
  /** The median of each RSS sample over the launches that have one; `undefined` when none do. */
  readonly rss?: RunRss
  /** The fastest and slowest first open's headline, `undefined` when none reached it. */
  readonly range?: { readonly min: number; readonly max: number }
}

/** The medians per engine, over the launches that did not fail. */
export function summarise(report: OpenTimeReport): EngineSummary[] {
  const engines = [...new Set(report.runs.map((r) => r.engine))]
  return engines.map((engine) => {
    const runs = report.runs.filter((r) => r.engine === engine)
    const medians = (pick: (r: RunResult) => OpenTimes | null) => {
      const out: OpenTimes = {}
      for (const key of [...PHASES, ...EXTRAS]) {
        const value = median(runs.flatMap((r) => pick(r)?.[key] ?? []))
        if (value != null) out[key] = value
      }
      return out
    }
    const headlines = runs.flatMap((r) => r.first[HEADLINE] ?? [])
    const rss = summariseRss(runs)
    return {
      engine,
      succeeded: headlines.length,
      launches: runs.length,
      first: medians((r) => r.first),
      second: medians((r) => r.second),
      ...(rss ? { rss } : {}),
      ...(headlines.length > 0 ?
        { range: { min: Math.min(...headlines), max: Math.max(...headlines) } }
      : {}),
    }
  })
}

function summariseRss(runs: readonly RunResult[]): RunRss | undefined {
  const samples = runs.flatMap((r) => r.rss ?? [])
  if (samples.length === 0) return undefined
  const m = (pick: (r: RunRss) => number) => median(samples.map(pick))!
  return {
    atWelcome: {
      engineKb: m((r) => r.atWelcome.engineKb),
      ydocKb: m((r) => r.atWelcome.ydocKb),
    },
    after30s: {
      engineKb: m((r) => r.after30s.engineKb),
      ydocKb: m((r) => r.after30s.ydocKb),
    },
  }
}

/** develop's first-open medians for one engine, pooled over `reports` of its runs. */
export interface Develop {
  readonly engine: Engine
  /** How many develop reports were pooled. */
  readonly reports: number
  readonly first: OpenTimes
}

/* Note [Noisy Medians]
 * ~~~~~~~~~~~~~~~~~~~~
 * A shared runner's open time is noisy: in CI the 5 launches of one run span 6.6 to 15.9 s, and
 * the medians of seven develop runs with no relevant change span 8.1 to 12.6 s (the open-performance
 * review, finding I1). Comparing with the newest develop run alone flagged a docs-only PR as "47%
 * worse". So a comparison is made with the median of develop's last `BASELINE_RUNS` reports (the
 * median of their per-run medians, phase by phase), and a regression needs both the percentage
 * and an absolute delta (`minDeltaMs`) to be exceeded. The spread of the launches is reported
 * beside the median, so a reader can tell a slow run from a noisy one. Replaying the review's
 * data, this raises no warning for the docs-only PR and still catches a +3 s slowdown.
 */

/** develop's medians per engine, pooled over the newest `BASELINE_RUNS` comparable reports. */
export function developMedians(report: OpenTimeReport, baseline: Baseline): Develop[] {
  const reports = baselineReports(report, baseline).slice(0, BASELINE_RUNS)
  return [...new Set(report.runs.map((r) => r.engine))].flatMap((engine) => {
    // `jvm` numbers are comparable only when made through the shim's cache (`shimAot`); an older
    // report's `jvm` had the harness's own cache (`jvmAot`), or none.
    const summaries = reports
      .filter((b) => engine !== 'jvm' || b.shimAot != null)
      .flatMap(
        (b) => summarise(b).find((s) => s.engine === engine && s.succeeded >= MIN_SUCCESSFUL) ?? [],
      )
    if (summaries.length === 0) return []
    const first: OpenTimes = {}
    for (const key of [...PHASES, ...EXTRAS]) {
      const value = median(summaries.flatMap((s) => s.first[key] ?? []))
      if (value != null) first[key] = value
    }
    return [{ engine, reports: summaries.length, first }]
  })
}

/** The `shimAot` line of `open-time.md`. */
export function describeShimAot(aot: ShimAot): string {
  const mib = (aot.cacheBytes / 1024 / 1024).toFixed(1)
  const rejected =
    aot.rejectedIn.length === 0 ?
      'never rejected'
    : `rejected in launches ${aot.rejectedIn.join(', ')}`
  const uncached =
    aot.uncachedIn != null && aot.uncachedIn.length > 0 ?
      `; no classes from the cache in launches ${aot.uncachedIn.join(', ')}`
    : ''
  const unchecked =
    aot.uncheckedIn != null && aot.uncheckedIn.length > 0 ?
      `; cache use not checked (no hsperf counters) in launches ${aot.uncheckedIn.join(', ')}`
    : ''
  return `Shim AOT cache: trained in ${(aot.trainingMs / 1000).toFixed(1)} s, ${mib} MiB, ${rejected}${uncached}${unchecked}.`
}

const cell = (value: number | undefined) => (value == null ? '–' : String(Math.round(value)))

/** The spare engines' medians: ready, warm-up, CPU at ready, idle memory, and opens that used one. */
export function spareTable(report: OpenTimeReport): string {
  const engines = [...new Set(report.runs.map((r) => r.engine))].filter(isSpareEngine)
  if (engines.length === 0) return ''
  const rows = engines.map((engine) => {
    const runs = report.runs.filter((r) => r.engine === engine && r.spare != null)
    const spares = runs.map((r) => r.spare!)
    const med = (values: number[]) => cell(median(values))
    const idle = median(spares.flatMap((s) => (s.idleEngineKb == null ? [] : [s.idleEngineKb])))
    const opens = runs.reduce((n, r) => n + (r.second != null ? 2 : 1), 0)
    const usedOpens = spares.reduce((n, s) => n + s.used.length, 0)
    return `| ${engine} | ${runs.length} | ${med(spares.flatMap((s) => s.readyMs))} | ${med(spares.flatMap((s) => s.warmUpMs))} | ${med(spares.flatMap((s) => s.cpuMs))} | ${idle == null ? '–' : Math.round(idle / 1024)} | ${usedOpens}/${opens} |`
  })
  return [
    'Spare engines (medians over the launches; ready is from the spare’s own start; idle memory is the engine processes’ before the first open, MiB).',
    '',
    '| Engine | Launches | Ready (ms) | Warm-up (ms) | Process CPU at ready (ms) | Idle (MiB) | Opens that used a spare |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n')
}

/** Each engine's headline over native's, first and second open; empty without native launches. */
export function ratioTable(report: OpenTimeReport): string {
  const summaries = summarise(report)
  const native = summaries.find((s) => s.engine === 'native')
  if (native == null) return ''
  const ratio = (s: EngineSummary, open: 'first' | 'second') => {
    const engine = s[open][HEADLINE]
    const base = native[open][HEADLINE]
    return engine == null || base == null ? '–' : (engine / base).toFixed(2)
  }
  return [
    'Headline over native (medians). The re-gate: the first open, at 8 CPUs, at most 1.5.',
    '',
    '| Engine | First open | Second open |',
    '| --- | ---: | ---: |',
    ...summaries
      .filter((s) => s.engine !== 'native')
      .map((s) => `| ${s.engine} | ${ratio(s, 'first')} | ${ratio(s, 'second')} |`),
  ].join('\n')
}

/** The CPUs the IDE was pinned to, or that the launches differ; empty when none was read. */
export function cpusLine(report: OpenTimeReport): string {
  const counts = [...new Set(report.runs.flatMap((r) => (r.cpus == null ? [] : [r.cpus])))].sort(
    (a, b) => a - b,
  )
  if (counts.length === 0) return ''
  return counts.length === 1 ?
      `CPUs (the IDE’s affinity): ${counts[0]}.`
    : `CPUs (the IDE’s affinity) differ between launches: ${counts.join(', ')}.`
}

/** The RSS medians, in MiB: one row per engine that has samples; empty when none has. */
function rssTable(summaries: readonly EngineSummary[], platform: string): string[] {
  const rows = summaries.flatMap((s) => {
    if (s.rss == null) return []
    const mib = (kb: number) => String(Math.round(kb / 1024))
    return [
      `| ${s.engine} | ${mib(s.rss.atWelcome.engineKb)} | ${mib(s.rss.after30s.engineKb)} | ${mib(s.rss.atWelcome.ydocKb)} | ${mib(s.rss.after30s.ydocKb)} |`,
    ]
  })
  if (rows.length === 0) return []
  return [
    `${platform === 'win32' ? 'Working set' : 'Resident memory'}, MiB, medians of the first open (engine: the launcher and the JVM or native image under it; ydoc: the utility process).`,
    '',
    '| Engine | Engine at welcome table | Engine 30 s later | Ydoc host at welcome table | Ydoc host 30 s later |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
  ]
}

/** The medians as a Markdown table, with develop's first-open medians when there is a baseline. */
export function renderMarkdown(report: OpenTimeReport, baseline: Baseline): string {
  const ours = summarise(report)
  const theirs = developMedians(report, baseline)
  const header = ['Phase (end mark), ms from the click']
  for (const s of ours) {
    header.push(`${s.engine} first`, `${s.engine} second`)
    const n = theirs.find((t) => t.engine === s.engine)?.reports
    if (n != null) header.push(`${s.engine} first, develop${n > 1 ? ` (median of ${n} runs)` : ''}`)
  }
  const rows = [...PHASES, ...EXTRAS].map((key) => {
    const row = [key === HEADLINE ? `**${LABELS[key]}**` : LABELS[key]]
    for (const s of ours) {
      row.push(cell(s.first[key]), cell(s.second[key]))
      const t = theirs.find((d) => d.engine === s.engine)
      if (t) row.push(cell(t.first[key]))
    }
    return `| ${row.join(' | ')} |`
  })
  const counts = ours
    .map(
      (s) =>
        `${s.engine}: ${s.succeeded} of ${s.launches} launches${s.range ? `, welcome table from ${Math.round(s.range.min)} to ${Math.round(s.range.max)} ms` : ''}`,
    )
    .join('; ')
  return [
    `Medians, ${report.platform}, ${report.template} template${report.commit ? ` at \`${report.commit.slice(0, 10)}\`` : ''} (${counts})${report.project ? `; project \`${report.project}\`: the headline is its library's table` : ''}.`,
    '',
    ...(report.shimAot ? [describeShimAot(report.shimAot), ''] : []),
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows,
    '',
    ...rssTable(ours, report.platform),
  ].join('\n')
}

/**
 * The spec's thresholds: a median over 4 s, or more than 15% and more than `minDeltaMs` worse than
 * develop's (Note [Noisy Medians]).
 */
export const DEFAULT_LIMITS = { limitMs: 4000, tolerance: 0.15, minDeltaMs: 2000 } as const
/** Fewer successful first opens than this give no median. */
export const MIN_SUCCESSFUL = 3

/** The warnings for the headline median of each engine; empty when all is well. */
export function regressionWarnings(
  report: OpenTimeReport,
  baseline: Baseline,
  limits: { limitMs: number; tolerance: number; minDeltaMs: number } = DEFAULT_LIMITS,
): string[] {
  const warnings: string[] = []
  const previous = developMedians(report, baseline)
  for (const engine of new Set(report.runs.map((r) => r.engine))) {
    const missing = new Set(
      report.runs
        .filter((r) => r.engine === engine && r.error == null)
        .flatMap((r) => r.notMeasured),
    )
    if (missing.size > 0) {
      warnings.push(`${engine}: not measured in some launches: ${[...missing].join(', ')}`)
    }
  }
  if (report.shimAot != null && report.shimAot.rejectedIn.length > 0) {
    warnings.push(
      `jvm: the shim's AOT cache was rejected (and deleted) after launches ${report.shimAot.rejectedIn.join(', ')}; that launch and the later ones ran uncached`,
    )
  }
  if (report.shimAot?.uncachedIn != null && report.shimAot.uncachedIn.length > 0) {
    warnings.push(
      `jvm: launches ${report.shimAot.uncachedIn.join(', ')} loaded almost no classes from the AOT cache (hsperf sharedClasses), so they ran uncached`,
    )
  }
  if (report.shimAot?.uncheckedIn != null && report.shimAot.uncheckedIn.length > 0) {
    warnings.push(
      `jvm: launches ${report.shimAot.uncheckedIn.join(', ')} have no hsperf counters, so whether they used the AOT cache is unknown`,
    )
  }
  // A launch that reached the welcome table but failed later (the second open) still counts in the
  // medians, so its failure is said here.
  for (const run of report.runs) {
    if (run.error != null && run.first[HEADLINE] != null) {
      warnings.push(`${run.engine} launch ${run.run} failed after its first open: ${run.error}`)
    }
  }
  for (const s of summarise(report)) {
    if (s.succeeded < MIN_SUCCESSFUL) {
      warnings.push(
        `${s.engine}: only ${s.succeeded} of ${s.launches} first opens reached the welcome table; no median`,
      )
      continue
    }
    const ours = s.first[HEADLINE]!
    if (ours > limits.limitMs) {
      warnings.push(
        `${s.engine}: the cold open takes ${Math.round(ours)} ms, over ${limits.limitMs} ms`,
      )
    }
    const develop = previous.find((p) => p.engine === s.engine)
    const theirs = develop?.first[HEADLINE]
    // Note [Noisy Medians]: both the percentage and the absolute delta.
    if (
      develop != null &&
      theirs != null &&
      ours > theirs * (1 + limits.tolerance) &&
      ours - theirs > limits.minDeltaMs
    ) {
      const worse = Math.round((ours / theirs - 1) * 100)
      const spread =
        s.range ? ` (launches ${Math.round(s.range.min)} to ${Math.round(s.range.max)} ms)` : ''
      const of =
        develop.reports > 1 ? `the median of develop's last ${develop.reports} runs` : "develop's"
      warnings.push(
        `${s.engine}: the cold open takes ${Math.round(ours)} ms${spread}, ${worse}% worse than ${of}, ${Math.round(theirs)} ms`,
      )
    }
  }
  return warnings
}

/** Variables of services that hold credentials, by prefix: everything of theirs is dropped. */
const CREDENTIAL_PREFIXES =
  /^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS|ANTHROPIC|OPENAI|PG[A-Z_]*$|ACTIONS_|GITHUB_TOKEN$|GH_TOKEN$)/i
/** Any variable that is named like a secret, whoever owns it. */
const CREDENTIAL_SUFFIXES = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|_KEY|APIKEY)S?$/i
/** The JVM reads these from the environment. A measured launch sets its own. */
const JVM_OPTION_VARIABLES = /^(JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS)$/

/**
 * `env` without the credential variables (the spec: every run starts without them), and without
 * the variables that give the JVM options, which would leak into a native measurement or replace
 * a JVM one's AOT cache.
 */
export function credentialFreeEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] != null &&
        !CREDENTIAL_PREFIXES.test(entry[0]) &&
        !CREDENTIAL_SUFFIXES.test(entry[0]) &&
        !JVM_OPTION_VARIABLES.test(entry[0]),
    ),
  )
}

/** The engines named by `--engines` (comma-separated); throws on an unknown one. */
export function parseEngines(value: string): Engine[] {
  return value.split(',').map((e) => {
    const engine = e.trim()
    if (engine === 'jvm-nocache') {
      throw new Error(
        "The engine jvm-nocache is gone: `jvm` is now the shim's own AOT cache, and `jvm-first` is a user's first launch, with no cache yet",
      )
    }
    if (!(ENGINES as readonly string[]).includes(engine)) {
      throw new Error(`Unknown engine: ${engine}`)
    }
    return engine as Engine
  })
}

/** `JAVA_TOOL_OPTIONS` made of several parts, the missing or blank ones left out. */
export function joinJvmOptions(...parts: readonly (string | undefined)[]): string {
  return parts
    .map((p) => p?.trim())
    .filter((p): p is string => p != null && p !== '')
    .join(' ')
}

/** The libraries the new-project template may import for `core`. */
const CORE_LIBRARIES = new Set(['Base', 'Table', 'Database', 'Examples', 'Visualization'])

/**
 * Which template a new project's `Main.enso` comes from: `full` when it imports `Standard.AWS`
 * (before #482), `core` when it imports only the core libraries, and `other` otherwise, so that
 * a later change of the template is never compared with an earlier one.
 */
export function classifyTemplate(main: string): Template {
  const libraries = [...main.matchAll(/^(?:from|import)\s+Standard\.(\w+)/gm)].map((m) => m[1]!)
  if (libraries.includes('AWS')) return 'full'
  return libraries.every((l) => CORE_LIBRARIES.has(l)) ? 'core' : 'other'
}
