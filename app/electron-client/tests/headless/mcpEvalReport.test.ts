/* eslint-disable camelcase -- tool argument and stream field names are snake_case on the wire */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  appendHistory,
  historyHeader,
  historyRows,
  median,
  readBaseline,
  renderReport,
  runDirectoryName,
  summariseTasks,
  type RunRecord,
  type TaskRunRecord,
} from '../../mcp-eval/report'

const record = (
  task: string,
  repeat: number,
  patch: Partial<TaskRunRecord> = {},
): TaskRunRecord => ({
  task,
  repeat,
  status: 'pass',
  checks: [{ name: 'c', passed: true }],
  ended: 'done',
  turns: 10,
  toolCalls: 12,
  toolCallsByName: { get_graph: 12 },
  toolErrors: 1,
  refusals: { live: 1 },
  wallMs: 60_000,
  agentDurationMs: 50_000,
  tokens: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 },
  costUsd: 0.5,
  dir: `${task}-${repeat}`,
  ...patch,
})

const run = (runs: TaskRunRecord[], patch: Partial<RunRecord> = {}): RunRecord => ({
  name: '2026-11-18T10-00-00Z-abc1234',
  startedAt: '2026-11-18T10:00:00.000Z',
  commit: 'abc1234',
  ideVersion: '2026.1.1-dev',
  cliVersion: '2.1.325 (Claude Code)',
  model: 'sonnet',
  effort: undefined,
  options: { budgetUsd: 10 },
  runs,
  totalCostUsd: runs.reduce((a, r) => a + r.costUsd, 0),
  skipped: [],
  ...patch,
})

describe('median', () => {
  test.each([
    [[], 0],
    [[5], 5],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
  ])('%j is %j', (values, expected) => expect(median(values)).toBe(expected))
})

describe('summariseTasks', () => {
  test('counts passes and takes medians over the repeats, in first-seen order', () => {
    const summaries = summariseTasks([
      record('b', 1, { turns: 4 }),
      record('a', 1, { turns: 10 }),
      record('b', 2, { turns: 8, status: 'fail' }),
      record('b', 3, { turns: 6 }),
    ])
    expect(summaries.map((s) => s.task)).toEqual(['b', 'a'])
    expect(summaries[0]).toMatchObject({ runs: 3, passes: 2, turns: 6, refusals: 1 })
  })
})

describe('renderReport', () => {
  test('a row per task with its pass count, and the total cost', () => {
    const text = renderReport(run([record('join', 1), record('join', 2, { status: 'fail' })]))
    expect(text).toContain('| join | 1/2 | 10 | 12 | 1 | 60 s | $0.50 |')
    expect(text).toContain('Total cost: $1.00')
    expect(text).toContain('Model: sonnet')
  })
  test('failed checks are named under Failures', () => {
    const failing = record('layout', 1, {
      status: 'fail',
      checks: [{ name: 'no two nodes overlap', passed: false, detail: '3 pairs' }],
    })
    const text = renderReport(run([failing]))
    expect(text).toContain('## Failures')
    expect(text).toContain('**layout #1** (done): no two nodes overlap')
  })
  test('a baseline adds its figures under each task', () => {
    const baseline = run([record('join', 1, { turns: 20, costUsd: 1 })], {
      name: 'older',
      model: 'opus',
    })
    const text = renderReport(run([record('join', 1)]), baseline)
    expect(text).toContain('Baseline: older (opus)')
    expect(text).toContain('| ↳ baseline | 1/1 | 20 | 12 | 1 | 60 s | $1.00 |')
  })
  test('tasks left unstarted by the budget are listed', () => {
    const text = renderReport(
      run([record('a', 1)], { skipped: ['b #1'], options: { budgetUsd: 1 } }),
    )
    expect(text).toContain('Not started, because the budget ($1.00) would have been passed: b #1')
  })
})

describe('history.csv', () => {
  test('one row per task run, matching the header, with quoting', () => {
    const rows = historyRows(
      run([record('join', 1), record('csv', 2, { status: 'fail' })], { model: 'a,b' }),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('"a,b"')
    expect(rows[0]!.split(',').length).toBe(historyHeader().split(',').length + 1)
    expect(rows[1]).toContain(',fail,done,')
  })
  test('the header is written once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-eval-history-'))
    try {
      appendHistory(dir, run([record('join', 1)]))
      appendHistory(dir, run([record('join', 1)]))
      const lines = fs.readFileSync(path.join(dir, 'history.csv'), 'utf8').trim().split('\n')
      expect(lines).toHaveLength(3)
      expect(lines[0]).toBe(historyHeader())
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('run folders', () => {
  test('are named by timestamp and commit, safe for a path', () => {
    expect(runDirectoryName(new Date('2026-11-18T10:20:30.456Z'), 'abc1234')).toBe(
      '2026-11-18T10-20-30Z-abc1234',
    )
    expect(runDirectoryName(new Date('2026-11-18T10:20:30Z'), 'WIP')).toMatch(/-WIP$/)
  })
  test('a baseline is read from the folder or its run.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-eval-base-'))
    try {
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run([record('a', 1)])))
      expect(readBaseline(dir).runs).toHaveLength(1)
      expect(readBaseline(path.join(dir, 'run.json')).commit).toBe('abc1234')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
