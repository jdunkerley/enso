/* eslint-disable camelcase -- result field names are snake_case on the wire */
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { LIVE_EDIT_ERROR, NOTHING_TO_REDO_ERROR, NOTHING_TO_UNDO_ERROR } from '../editSession'
import { UNSETTLED_NOTE } from '../editTools'
import { redoTool, undoTool, type HistoryToolDeps } from '../historyTools'

const caller = { kind: 'external', name: 'claude-code' } as const
const DEADLINE = 123_456

type Session = HistoryToolDeps['session']

function makeDeps(overrides: Partial<Session> = {}) {
  const session = {
    undo: vi.fn<Session['undo']>(async () =>
      Ok({ value: { can_undo: false, can_redo: true }, settled: true }),
    ),
    redo: vi.fn<Session['redo']>(async () =>
      Ok({ value: { can_undo: true, can_redo: false }, settled: true }),
    ),
    ...overrides,
  }
  const deps: HistoryToolDeps = { session, caller, deadline: DEADLINE }
  return { deps, session }
}

function valueOf(result: McpToolResult): unknown {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return JSON.parse(result.value)
}

test('undo answers what was done and what can still be done', async () => {
  const { deps } = makeDeps()
  expect(valueOf(await undoTool(deps))).toEqual({
    undone: true,
    can_undo: false,
    can_redo: true,
    settled: true,
  })
})

test('redo answers what was done and what can still be done', async () => {
  const { deps } = makeDeps()
  expect(valueOf(await redoTool(deps))).toEqual({
    redone: true,
    can_undo: true,
    can_redo: false,
    settled: true,
  })
})

test('undo and redo pass the caller and the deadline on', async () => {
  const { deps, session } = makeDeps()
  await undoTool(deps)
  await redoTool(deps)
  expect(session.undo).toHaveBeenCalledWith(caller, { deadline: DEADLINE })
  expect(session.redo).toHaveBeenCalledWith(caller, { deadline: DEADLINE })
})

test('undo and redo pass the session refusals on as errors', async () => {
  for (const error of [NOTHING_TO_UNDO_ERROR, LIVE_EDIT_ERROR]) {
    const { deps } = makeDeps({ undo: vi.fn(async () => Err(error)) })
    const result = await undoTool(deps)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBe(error)
  }
  for (const error of [NOTHING_TO_REDO_ERROR, LIVE_EDIT_ERROR]) {
    const { deps } = makeDeps({ redo: vi.fn(async () => Err(error)) })
    const result = await redoTool(deps)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBe(error)
  }
})

test('an unsettled undo says so', async () => {
  const { deps } = makeDeps({
    undo: vi.fn(async () => Ok({ value: { can_undo: true, can_redo: true }, settled: false })),
  })
  expect(valueOf(await undoTool(deps))).toEqual({
    undone: true,
    can_undo: true,
    can_redo: true,
    settled: false,
    note: UNSETTLED_NOTE,
  })
})
