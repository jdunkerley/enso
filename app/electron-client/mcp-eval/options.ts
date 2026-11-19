/**
 * @file The command line of `mcp-eval` and the budget rules. Pure: no process state is read except
 * what the caller passes in.
 */
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

export const DEFAULT_MODEL = 'sonnet'
export const DEFAULT_MAX_TURNS = 60
export const DEFAULT_TIMEOUT_MINUTES = 15
/** No task gets more than this unless `--task-budget-usd` says so. */
export const MAX_DEFAULT_TASK_BUDGET_USD = 3

export interface Options {
  /** The most the run may spend, in USD. Absent only for `--self-check` and `--dry-run`. */
  readonly budgetUsd: number | undefined
  readonly tasks: readonly string[]
  readonly repeat: number
  readonly model: string
  readonly effort: string | undefined
  readonly out: string
  readonly exe: string | undefined
  readonly baseline: string | undefined
  readonly selfCheck: boolean
  readonly dryRun: boolean
  readonly keepTemp: boolean
  readonly aot: boolean
  readonly maxTurns: number
  readonly timeoutMinutes: number
  readonly taskBudgetUsd: number | undefined
}

/** The default output directory, outside the repository. */
export function defaultOut(home: string = os.homedir()): string {
  return path.join(home, 'enso-mcp-eval')
}

/** Refuses to run in CI: the suite spends money and is on demand only. */
export function refuseInCi(env: Readonly<Record<string, string | undefined>>): void {
  if (env.CI != null && env.CI !== '' && env.CI !== 'false' && env.CI !== '0') {
    throw new Error('mcp-eval is on demand only and does not run in CI (CI is set).')
  }
}

function positiveNumber(name: string, value: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`--${name} must be a positive number, not ${JSON.stringify(value)}`)
  }
  return number
}

function positiveInteger(name: string, value: string): number {
  const number = positiveNumber(name, value)
  if (!Number.isInteger(number)) throw new Error(`--${name} must be a whole number, not ${value}`)
  return number
}

/**
 * Reads the command line. `taskIds` are the known tasks (the default is all of them, in order).
 * Throws an `Error` with a message for the user on anything wrong.
 */
export function parseOptions(
  argv: readonly string[],
  taskIds: readonly string[],
  home: string = os.homedir(),
): Options {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : [...argv],
      options: {
        'budget-usd': { type: 'string' },
        tasks: { type: 'string' },
        repeat: { type: 'string' },
        model: { type: 'string' },
        effort: { type: 'string' },
        out: { type: 'string' },
        exe: { type: 'string' },
        baseline: { type: 'string' },
        'self-check': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'keep-temp': { type: 'boolean' },
        aot: { type: 'boolean' },
        'max-turns': { type: 'string' },
        'timeout-minutes': { type: 'string' },
        'task-budget-usd': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e), { cause: e })
  }
  const selfCheck = values['self-check'] ?? false
  const dryRun = values['dry-run'] ?? false
  const budgetUsd =
    values['budget-usd'] != null ? positiveNumber('budget-usd', values['budget-usd']) : undefined
  if (budgetUsd == null && !selfCheck && !dryRun) {
    throw new Error(
      '--budget-usd <dollars> is required: the most this run may spend (there is no default, so nothing spends by accident).',
    )
  }
  const tasks =
    values.tasks != null ?
      values.tasks
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '')
    : [...taskIds]
  if (tasks.length === 0) throw new Error('--tasks names no task')
  for (const task of tasks) {
    if (!taskIds.includes(task)) {
      throw new Error(`Unknown task ${task}. The tasks are: ${taskIds.join(', ')}`)
    }
  }
  if (new Set(tasks).size !== tasks.length) throw new Error('--tasks names a task twice')
  return {
    budgetUsd,
    tasks,
    repeat: values.repeat != null ? positiveInteger('repeat', values.repeat) : 1,
    model: values.model ?? DEFAULT_MODEL,
    effort: values.effort,
    out: path.resolve(values.out ?? defaultOut(home)),
    exe: values.exe != null ? path.resolve(values.exe) : undefined,
    baseline: values.baseline != null ? path.resolve(values.baseline) : undefined,
    selfCheck,
    dryRun,
    keepTemp: values['keep-temp'] ?? false,
    aot: values.aot ?? false,
    maxTurns:
      values['max-turns'] != null ?
        positiveInteger('max-turns', values['max-turns'])
      : DEFAULT_MAX_TURNS,
    timeoutMinutes:
      values['timeout-minutes'] != null ?
        positiveNumber('timeout-minutes', values['timeout-minutes'])
      : DEFAULT_TIMEOUT_MINUTES,
    taskBudgetUsd:
      values['task-budget-usd'] != null ?
        positiveNumber('task-budget-usd', values['task-budget-usd'])
      : undefined,
  }
}

/**
 * What one task run may spend: `--task-budget-usd`, else the run's budget divided by the number of
 * task runs (tasks times repeats), at most {@link MAX_DEFAULT_TASK_BUDGET_USD}.
 */
export function taskBudgetUsd(
  options: Pick<Options, 'budgetUsd' | 'taskBudgetUsd'>,
  taskRuns: number,
): number {
  if (options.taskBudgetUsd != null) return options.taskBudgetUsd
  if (options.budgetUsd == null) return MAX_DEFAULT_TASK_BUDGET_USD
  return Math.min(MAX_DEFAULT_TASK_BUDGET_USD, options.budgetUsd / Math.max(1, taskRuns))
}

/** Whether a task with `nextBudget` may start, given what the run has spent. */
export function mayStartTask(runBudgetUsd: number, spentUsd: number, nextBudget: number): boolean {
  // A cent of slack for float sums: 0.1 + 0.2 must not stop a run that fits exactly.
  return spentUsd + nextBudget <= runBudgetUsd + 1e-9
}
