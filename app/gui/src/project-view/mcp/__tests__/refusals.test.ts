/**
 * @file The `refused` flag on the project tools' failures (#864): a house rule refusing a call is
 * told apart from the call failing.
 */
import type { McpApi } from '$/electronApi'
import { startMcpToolDispatcher } from '$/mcp/toolDispatcher'
import type { McpToolCallRequest, McpToolResult } from 'enso-common/src/mcp'
import { describe, expect, test, vi } from 'vitest'
import {
  LIVE_EDIT_ERROR,
  NOTHING_LEFT_TO_UNDO_ERROR,
  REDO_OUTPUT_ERROR,
  UNDO_OUTPUT_ERROR,
} from '../editSession'
import { evaluateExpression, LIVE_MODE_ERROR } from '../evaluate'
import { isRuleRefusal, markingRefusals, markRefusal } from '../refusals'
import { VERSIONS_NOT_KEPT_ERROR } from '../versionTools'
import { WRITE_REFUSED_ERROR } from '../writeGuard'

describe('markRefusal', () => {
  test.each([
    ['Live mode', LIVE_MODE_ERROR],
    ['Live mode, for edits', LIVE_EDIT_ERROR],
    ['the Write rule', WRITE_REFUSED_ERROR],
    ['undo of code that can write', UNDO_OUTPUT_ERROR],
    ['redo of code that can write', REDO_OUTPUT_ERROR],
    ['the undo floor', NOTHING_LEFT_TO_UNDO_ERROR],
    ['versions that are not kept', VERSIONS_NOT_KEPT_ERROR],
  ])('flags %s', (_name, error) => {
    expect(markRefusal({ ok: false, error })).toEqual({ ok: false, error, refused: true })
    expect(isRuleRefusal(error)).toBe(true)
  })

  test('flags a rule answer that has a preamble', () => {
    const error = `Could not add the node: ${WRITE_REFUSED_ERROR}`
    expect(markRefusal({ ok: false, error })).toMatchObject({ refused: true })
  })

  test('leaves an ordinary failure unflagged', () => {
    const result: McpToolResult = { ok: false, error: 'No node with the id abc.' }
    expect(markRefusal(result)).toBe(result)
    expect('refused' in markRefusal(result)).toBe(false)
  })

  test('leaves a success alone', () => {
    const result: McpToolResult = { ok: true, value: LIVE_MODE_ERROR }
    expect(markRefusal(result)).toBe(result)
  })

  test('marks a handler that applies a rule: evaluate_expression in Live', async () => {
    const handler = markingRefusals(async (args) =>
      evaluateExpression(
        {
          isLive: () => true,
          db: {} as never,
          currentMethod: {} as never,
          evaluateRaw: async () => null,
        },
        { expression: String(args.expression) },
      ),
    )
    expect(await handler({ expression: '1' }, { kind: 'chat' }, 0)).toEqual({
      ok: false,
      error: LIVE_MODE_ERROR,
      refused: true,
    })
  })
})

describe('the dispatcher', () => {
  test('answers a call with no project open as refused', async () => {
    let handler: ((request: McpToolCallRequest) => void) | undefined
    const replyToolCall = vi.fn()
    const stop = startMcpToolDispatcher({
      onToolCall: (h) => {
        handler = h
        return () => {}
      },
      replyToolCall,
    } satisfies Pick<McpApi, 'onToolCall' | 'replyToolCall'>)
    handler?.({
      requestId: 'r',
      tool: 'get_graph_that_nobody_registered',
      args: {},
      caller: { kind: 'chat' },
      timeoutMs: 1000,
    })
    await vi.waitFor(() => expect(replyToolCall).toHaveBeenCalled())
    expect(replyToolCall.mock.calls[0]?.[0].result).toMatchObject({ ok: false, refused: true })
    stop()
  })
})
