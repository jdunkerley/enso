/* eslint-disable camelcase -- tool argument and stream field names are snake_case on the wire */
import { describe, expect, test } from 'vitest'
import { endedFromResult, StreamTally, summariseStream, toolName } from '../../mcp-eval/stream'

/**
 * A stream in the shape `claude -p --output-format stream-json --verbose` writes (Claude Code
 * 2.1.325): one `system` line, one `assistant` line per content block of a response (several
 * lines share a message id), one `user` line per tool result, and the final `result`. Written by
 * hand from that format: no agent run was made to record it.
 */
const SAMPLE = [
  { type: 'system', subtype: 'init', tools: ['mcp__enso__get_graph'], model: 'sonnet' },
  {
    type: 'assistant',
    message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }] },
  },
  {
    type: 'assistant',
    message: {
      id: 'msg_1',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'mcp__enso__get_graph', input: {} }],
    },
  },
  {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: '{}' }] },
      ],
    },
  },
  {
    type: 'assistant',
    message: {
      id: 'msg_2',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_2', name: 'mcp__enso__edit_node', input: {} },
        { type: 'tool_use', id: 'tu_3', name: 'mcp__enso__edit_node', input: {} },
      ],
    },
  },
  {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_2',
          is_error: true,
          content: 'The project is in Live mode. Edits by an agent are refused there.',
        },
        {
          type: 'tool_result',
          tool_use_id: 'tu_3',
          is_error: true,
          content: [
            { type: 'text', text: 'Only the user can turn Write on. Remove with_enabled_context' },
          ],
        },
      ],
    },
  },
  {
    type: 'assistant',
    message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 41_000,
    duration_api_ms: 30_000,
    num_turns: 3,
    result: 'Done.',
    total_cost_usd: 0.4321,
    usage: {
      input_tokens: 120,
      output_tokens: 800,
      cache_creation_input_tokens: 5000,
      cache_read_input_tokens: 20_000,
    },
    permission_denials: [{ tool_name: 'Bash' }],
  },
]
  .map((line) => JSON.stringify(line))
  .join('\n')

describe('summariseStream', () => {
  const summary = summariseStream(SAMPLE)

  test('counts a turn per model response, not per line', () => {
    expect(summary.turns).toBe(3)
  })
  test('counts tool calls in total and per tool, without the server prefix', () => {
    expect(summary.toolCalls).toBe(3)
    expect(summary.toolCallsByName).toEqual({ get_graph: 1, edit_node: 2 })
  })
  test('counts tool errors, and the IDE’s refusals by kind (text or list content)', () => {
    expect(summary.toolErrors).toBe(2)
    expect(summary.refusals).toEqual({ live: 1, write: 1, permissionDenied: 1 })
  })
  test('reads cost, tokens and the agent’s own duration from the result', () => {
    expect(summary.result).toMatchObject({
      subtype: 'success',
      totalCostUsd: 0.4321,
      durationMs: 41_000,
      numTurns: 3,
      tokens: { input: 120, output: 800, cacheRead: 20_000, cacheCreation: 5000 },
      permissionDenials: 1,
      text: 'Done.',
    })
  })
  test('a line that is not JSON is counted, not fatal', () => {
    expect(summariseStream('not json\n{"type":"assistant"}').malformedLines).toBe(1)
  })
})

describe('StreamTally', () => {
  test('reports the turns so far line by line, for the turn cap', () => {
    const tally = new StreamTally()
    const turns = SAMPLE.split('\n').map((line) => tally.push(line))
    expect(turns).toEqual([0, 1, 1, 1, 2, 2, 3, 3])
  })
  test('a response with no id counts as a turn of its own', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } })
    const tally = new StreamTally()
    tally.push(line)
    expect(tally.push(line)).toBe(2)
  })
  test('a model refusal is counted', () => {
    const tally = new StreamTally()
    tally.push(
      JSON.stringify({
        type: 'assistant',
        message: { id: 'm', stop_reason: 'refusal', content: [] },
      }),
    )
    expect(tally.summary().refusals).toEqual({ modelRefusal: 1 })
  })
  test('a tool call repeated in a later line of the same response counts once', () => {
    const block = { type: 'tool_use', id: 'x', name: 'mcp__enso__undo', input: {} }
    const tally = new StreamTally()
    tally.push(JSON.stringify({ type: 'assistant', message: { id: 'm', content: [block] } }))
    tally.push(JSON.stringify({ type: 'assistant', message: { id: 'm', content: [block] } }))
    expect(tally.summary().toolCalls).toBe(1)
  })
})

describe('toolName', () => {
  test.each([
    ['mcp__enso__get_graph', 'get_graph'],
    ['mcp__my_server__a__b', 'a__b'],
    ['Bash', 'Bash'],
  ])('%s is %s', (name, expected) => expect(toolName(name)).toBe(expected))
})

describe('endedFromResult', () => {
  const result = (subtype: string, isError = false) =>
    summariseStream(JSON.stringify({ type: 'result', subtype, is_error: isError })).result
  test('done only for a successful result', () => {
    expect(endedFromResult(result('success'))).toBe('done')
    expect(endedFromResult(result('success', true))).toBe('error')
    expect(endedFromResult(result('error_during_execution', true))).toBe('error')
  })
  test('the budget is named, and no result at all is an error', () => {
    expect(endedFromResult(result('error_max_budget_usd', true))).toBe('budget')
    expect(endedFromResult(undefined)).toBe('error')
  })
})
