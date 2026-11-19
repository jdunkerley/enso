/**
 * @file The run's record and its report: `run.json`, `report.md` (per task the pass count and the
 * medians, the run's cost, and a baseline run's figures beside them) and `history.csv` (one row
 * per task run). Pure except for `appendHistory`.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Ended, Tokens } from './stream'
import type { CheckResult } from './task'

export interface TaskRunRecord {
  readonly task: string
  readonly repeat: number
  readonly status: 'pass' | 'fail'
  readonly checks: readonly CheckResult[]
  readonly ended: Ended | 'self-check'
  readonly turns: number
  readonly toolCalls: number
  readonly toolCallsByName: Readonly<Record<string, number>>
  readonly toolErrors: number
  /** Refusals by kind (the IDE's, `permissionDenied`, `modelRefusal`). */
  readonly refusals: Readonly<Record<string, number>>
  readonly wallMs: number
  readonly agentDurationMs: number
  readonly tokens: Tokens
  readonly costUsd: number
  /** Set when the run itself failed (the IDE did not start, a check could not run). */
  readonly error?: string
  /** The task's folder name under the run's directory. */
  readonly dir: string
}

export interface RunRecord {
  readonly name: string
  readonly startedAt: string
  readonly commit: string
  readonly ideVersion: string
  readonly cliVersion: string
  readonly model: string
  readonly effort: string | undefined
  readonly options: Readonly<Record<string, unknown>>
  readonly runs: readonly TaskRunRecord[]
  readonly totalCostUsd: number
  /** Tasks not started because the run budget would have been passed. */
  readonly skipped: readonly string[]
}

export const failedChecks = (run: TaskRunRecord): string[] =>
  run.checks.filter((c) => !c.passed).map((c) => c.name)

export const refusalCount = (run: TaskRunRecord): number =>
  Object.values(run.refusals).reduce((a, b) => a + b, 0)

/** The median of `values` (the mean of the middle two for an even count); 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export interface TaskSummary {
  readonly task: string
  readonly runs: number
  readonly passes: number
  readonly turns: number
  readonly toolCalls: number
  readonly refusals: number
  readonly wallMs: number
  readonly costUsd: number
}

/** Per task, in first-seen order: the pass count and the medians over its repeats. */
export function summariseTasks(runs: readonly TaskRunRecord[]): TaskSummary[] {
  const order: string[] = []
  const byTask = new Map<string, TaskRunRecord[]>()
  for (const run of runs) {
    if (!byTask.has(run.task)) {
      order.push(run.task)
      byTask.set(run.task, [])
    }
    byTask.get(run.task)!.push(run)
  }
  return order.map((task) => {
    const list = byTask.get(task)!
    return {
      task,
      runs: list.length,
      passes: list.filter((r) => r.status === 'pass').length,
      turns: median(list.map((r) => r.turns)),
      toolCalls: median(list.map((r) => r.toolCalls)),
      refusals: median(list.map(refusalCount)),
      wallMs: median(list.map((r) => r.wallMs)),
      costUsd: median(list.map((r) => r.costUsd)),
    }
  })
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(0)} s`
const dollars = (usd: number) => `$${usd.toFixed(2)}`
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** `report.md`. With `baseline`, each task row is followed by the baseline run's figures. */
export function renderReport(run: RunRecord, baseline?: RunRecord): string {
  const summaries = summariseTasks(run.runs)
  const base = new Map(summariseTasks(baseline?.runs ?? []).map((s) => [s.task, s]))
  const lines: string[] = [
    `# MCP effectiveness run ${run.name}`,
    '',
    `- Commit: ${run.commit}; IDE ${run.ideVersion}; Claude Code ${run.cliVersion}`,
    `- Model: ${run.model}${run.effort != null ? `, effort ${run.effort}` : ''}`,
    `- Started: ${run.startedAt}`,
    ...(baseline != null ? [`- Baseline: ${baseline.name} (${baseline.model})`] : []),
    '',
    'One run of one task is not evidence: an agent is not deterministic. Compare pass counts over',
    '`--repeat 3` or more, with the same model, before concluding that a change helped or hurt.',
    '',
    '| Task | Passed | Turns | Tool calls | Refusals | Wall | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const s of summaries) {
    lines.push(
      `| ${s.task} | ${s.passes}/${s.runs} | ${num(s.turns)} | ${num(s.toolCalls)} | ${num(s.refusals)} | ${seconds(s.wallMs)} | ${dollars(s.costUsd)} |`,
    )
    const b = base.get(s.task)
    if (b != null) {
      lines.push(
        `| ↳ baseline | ${b.passes}/${b.runs} | ${num(b.turns)} | ${num(b.toolCalls)} | ${num(b.refusals)} | ${seconds(b.wallMs)} | ${dollars(b.costUsd)} |`,
      )
    }
  }
  lines.push(
    '',
    'Medians over the repeats of each task.',
    '',
    `Total cost: ${dollars(run.totalCostUsd)}`,
  )
  if (run.skipped.length > 0) {
    lines.push(
      '',
      `Not started, because the budget (${dollars(Number(run.options.budgetUsd ?? 0))}) would have been passed: ${run.skipped.join(', ')}`,
    )
  }
  const failures = run.runs.filter((r) => r.status === 'fail' || r.error != null)
  if (failures.length > 0) {
    lines.push('', '## Failures', '')
    for (const r of failures) {
      const why = failedChecks(r)
      lines.push(
        `- **${r.task} #${r.repeat}** (${r.ended}): ${r.error ?? why.join('; ')} — \`${r.dir}/\``,
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

const HISTORY_COLUMNS = [
  'startedAt',
  'run',
  'commit',
  'model',
  'effort',
  'task',
  'repeat',
  'status',
  'ended',
  'turns',
  'toolCalls',
  'toolErrors',
  'refusals',
  'wallMs',
  'costUsd',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
] as const

const csvCell = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const historyHeader = (): string => HISTORY_COLUMNS.join(',')

/** One CSV row per task run of `run`. */
export function historyRows(run: RunRecord): string[] {
  return run.runs.map((r) =>
    [
      run.startedAt,
      run.name,
      run.commit,
      run.model,
      run.effort ?? '',
      r.task,
      r.repeat,
      r.status,
      r.ended,
      r.turns,
      r.toolCalls,
      r.toolErrors,
      refusalCount(r),
      r.wallMs,
      r.costUsd.toFixed(4),
      r.tokens.input,
      r.tokens.output,
      r.tokens.cacheRead,
      r.tokens.cacheCreation,
    ]
      .map(csvCell)
      .join(','),
  )
}

/** Appends `run`'s rows to `<out>/history.csv`, writing the header first when the file is new. */
export function appendHistory(out: string, run: RunRecord): void {
  const file = path.join(out, 'history.csv')
  const text = `${fs.existsSync(file) ? '' : `${historyHeader()}\n`}${historyRows(run).join('\n')}\n`
  fs.appendFileSync(file, text)
}

/** `<timestamp>-<commit or WIP>`, safe as a folder name. */
export function runDirectoryName(date: Date, commit: string): string {
  const stamp = date
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/-\d{3}Z$/, 'Z')
  return `${stamp}-${commit}`
}

/** Reads a baseline given as a run folder or its `run.json`. */
export function readBaseline(location: string): RunRecord {
  const file = fs.statSync(location).isDirectory() ? path.join(location, 'run.json') : location
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RunRecord
}
