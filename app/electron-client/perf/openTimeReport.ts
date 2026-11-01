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
export type Engine = 'native' | 'jvm'
/** The first open of a launch is cold; the second opens another project in the same session. */
export type OpenTag = 'first' | 'second'

/** One timestamped event the driver saw (`k` its kind, `t` epoch ms), as in the spike's `marks.json`. */
export interface Mark {
  readonly k: string
  readonly t: number
  readonly u?: string
  readonly [extra: string]: unknown
}

export interface RunResult {
  readonly engine: Engine
  readonly run: number
  readonly first: OpenTimes
  readonly second: OpenTimes | null
  /** The phases and extras a successful launch did not record, first and second open together. */
  readonly notMeasured: readonly (Phase | Extra)[]
  readonly error?: string
}

/** `core` when the new-project template has no `Standard.AWS` import (#482), `full` otherwise. */
export type Template = 'core' | 'full'

export interface OpenTimeReport {
  readonly version: 1
  readonly platform: string
  readonly commit: string | null
  readonly template: Template
  readonly runs: readonly RunResult[]
}

/** Whether `baseline` measured the same template, so that comparing with it means something. */
export function comparable(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
): baseline is OpenTimeReport {
  return baseline != null && baseline.template === report.template
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
    guiConnected: rel(after((m) => m.k === 'wsOpen' && (m.u ?? '').includes('/project/index'))),
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
    return {
      engine,
      succeeded: runs.filter((r) => r.first[HEADLINE] != null).length,
      launches: runs.length,
      first: medians((r) => r.first),
      second: medians((r) => r.second),
    }
  })
}

const cell = (value: number | undefined) => (value == null ? '–' : String(Math.round(value)))

/** The medians as a Markdown table, with develop's first-open medians when there is a baseline. */
export function renderMarkdown(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
): string {
  if (!comparable(report, baseline)) baseline = undefined
  const ours = summarise(report)
  const theirs = baseline ? summarise(baseline) : []
  const header = ['Phase (end mark), ms from the click']
  for (const s of ours) {
    header.push(`${s.engine} first`, `${s.engine} second`)
    if (baseline) header.push(`${s.engine} first, develop`)
  }
  const rows = [...PHASES, ...EXTRAS].map((key) => {
    const row = [key === HEADLINE ? `**${LABELS[key]}**` : LABELS[key]]
    for (const s of ours) {
      row.push(cell(s.first[key]), cell(s.second[key]))
      if (baseline) row.push(cell(theirs.find((t) => t.engine === s.engine)?.first[key]))
    }
    return `| ${row.join(' | ')} |`
  })
  const counts = ours.map((s) => `${s.engine}: ${s.succeeded} of ${s.launches} launches`).join(', ')
  return [
    `Medians, ${report.platform}, ${report.template} template${report.commit ? ` at \`${report.commit.slice(0, 10)}\`` : ''} (${counts}).`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows,
    '',
  ].join('\n')
}

/** The spec's thresholds: a median over 4 s, or more than 15% worse than develop's last run. */
export const DEFAULT_LIMITS = { limitMs: 4000, tolerance: 0.15 } as const
/** Fewer successful first opens than this give no median. */
export const MIN_SUCCESSFUL = 3

/** The warnings for the headline median of each engine; empty when all is well. */
export function regressionWarnings(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
  limits: { limitMs: number; tolerance: number } = DEFAULT_LIMITS,
): string[] {
  const warnings: string[] = []
  const previous = comparable(report, baseline) ? summarise(baseline) : []
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
    const theirs = previous.find((p) => p.engine === s.engine)?.first[HEADLINE]
    if (theirs != null && ours > theirs * (1 + limits.tolerance)) {
      const worse = Math.round((ours / theirs - 1) * 100)
      warnings.push(
        `${s.engine}: the cold open takes ${Math.round(ours)} ms, ${worse}% worse than develop's ${Math.round(theirs)} ms`,
      )
    }
  }
  return warnings
}

const CREDENTIALS =
  /^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS|GITHUB_TOKEN$|GH_TOKEN$)/i

/** `env` without the credential variables (the spec: every run starts without them). */
export function credentialFreeEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] != null && !CREDENTIALS.test(entry[0]),
    ),
  )
}
