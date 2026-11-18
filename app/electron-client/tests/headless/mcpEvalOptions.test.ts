import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_MAX_TURNS,
  MAX_DEFAULT_TASK_BUDGET_USD,
  mayStartTask,
  parseOptions,
  refuseInCi,
  taskBudgetUsd,
} from '../../mcp-eval/options'

const IDS = ['a', 'b', 'c']

describe('parseOptions', () => {
  test('a run needs --budget-usd and nothing spends by default', () => {
    expect(() => parseOptions([], IDS)).toThrow('--budget-usd')
  })
  test('self-check and dry-run need no budget', () => {
    expect(parseOptions(['--self-check'], IDS).budgetUsd).toBeUndefined()
    expect(parseOptions(['--dry-run'], IDS).dryRun).toBe(true)
  })
  test('defaults: every task, one repeat, sonnet, 60 turns, ~/enso-mcp-eval', () => {
    const options = parseOptions(['--budget-usd', '10'], IDS, '/home/me')
    expect(options).toMatchObject({
      budgetUsd: 10,
      tasks: IDS,
      repeat: 1,
      model: 'sonnet',
      maxTurns: DEFAULT_MAX_TURNS,
      timeoutMinutes: 15,
      selfCheck: false,
      keepTemp: false,
      aot: false,
    })
    expect(options.out).toBe(path.resolve('/home/me', 'enso-mcp-eval'))
  })
  test('reads every flag, and a leading -- (what pnpm passes)', () => {
    const options = parseOptions(
      [
        '--',
        '--budget-usd',
        '2.5',
        '--tasks',
        'b,a',
        '--repeat',
        '3',
        '--model',
        'opus',
        '--effort',
        'high',
        '--keep-temp',
        '--aot',
        '--max-turns',
        '5',
        '--timeout-minutes',
        '1.5',
        '--task-budget-usd',
        '0.5',
        '--baseline',
        'x',
        '--exe',
        'y',
      ],
      IDS,
    )
    expect(options).toMatchObject({
      budgetUsd: 2.5,
      tasks: ['b', 'a'],
      repeat: 3,
      model: 'opus',
      effort: 'high',
      keepTemp: true,
      aot: true,
      maxTurns: 5,
      timeoutMinutes: 1.5,
      taskBudgetUsd: 0.5,
    })
    expect(options.baseline).toBe(path.resolve('x'))
    expect(options.exe).toBe(path.resolve('y'))
  })
  test.each([
    [['--budget-usd', '0'], 'positive'],
    [['--budget-usd', 'lots'], 'positive'],
    [['--budget-usd', '1', '--repeat', '1.5'], 'whole number'],
    [['--budget-usd', '1', '--repeat', '0'], 'positive'],
    [['--budget-usd', '1', '--tasks', 'z'], 'Unknown task z'],
    [['--budget-usd', '1', '--tasks', 'a,a'], 'twice'],
    [['--budget-usd', '1', '--tasks', ''], 'names no task'],
    [['--budget-usd', '1', '--nope'], 'nope'],
    [['--budget-usd', '1', 'extra'], 'extra'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseOptions(argv, IDS)).toThrow(message)
  })
})

describe('refuseInCi', () => {
  test('refuses when CI is set, however it is set', () => {
    expect(() => refuseInCi({ CI: 'true' })).toThrow('CI')
    expect(() => refuseInCi({ CI: '1' })).toThrow('CI')
  })
  test('allows a machine with no CI variable, or CI=false', () => {
    expect(() => refuseInCi({})).not.toThrow()
    expect(() => refuseInCi({ CI: '' })).not.toThrow()
    expect(() => refuseInCi({ CI: 'false' })).not.toThrow()
  })
})

describe('budgets', () => {
  test('a task gets the run budget divided by the task runs, at most 3 USD', () => {
    expect(taskBudgetUsd({ budgetUsd: 7, taskBudgetUsd: undefined }, 7)).toBe(1)
    expect(taskBudgetUsd({ budgetUsd: 70, taskBudgetUsd: undefined }, 7)).toBe(
      MAX_DEFAULT_TASK_BUDGET_USD,
    )
    expect(taskBudgetUsd({ budgetUsd: 10, taskBudgetUsd: undefined }, 21)).toBeCloseTo(10 / 21)
  })
  test('--task-budget-usd overrides, even above 3', () => {
    expect(taskBudgetUsd({ budgetUsd: 10, taskBudgetUsd: 5 }, 7)).toBe(5)
  })
  test('a task starts only when what is spent plus its budget fits the run budget', () => {
    expect(mayStartTask(10, 0, 3)).toBe(true)
    expect(mayStartTask(10, 7, 3)).toBe(true)
    expect(mayStartTask(10, 7.01, 3)).toBe(false)
    expect(mayStartTask(0.3, 0.1 + 0.1, 0.1)).toBe(true)
  })
})
