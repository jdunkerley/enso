/** @file Tests for the MCP activity record (`src/mcp/mcpActivity.ts`). */
import type { McpActivitySnapshot } from 'enso-common/src/mcp'
import { beforeEach, describe, expect, test } from 'vitest'
import { McpActivity } from '../../src/mcp/mcpActivity'

let clock: number
let broadcasts: McpActivitySnapshot[]
let activity: McpActivity

beforeEach(() => {
  clock = 1_000_000
  broadcasts = []
  activity = new McpActivity(
    (snapshot) => broadcasts.push(snapshot),
    () => clock,
  )
})

describe('clients', () => {
  test('are listed most recently seen first, under the token when none was named', () => {
    activity.seen('claude-code')
    clock += 1000
    activity.seen('node')
    clock += 1000
    activity.seen('claude-code')
    expect(activity.snapshot().clients.map((c) => c.name)).toEqual(['claude-code', 'node'])
    expect(activity.snapshot().clients[0]?.lastSeenAt).toBe(clock)
  })

  test('keep at most 8, dropping the least recently seen', () => {
    for (let i = 0; i < 9; i++) {
      activity.seen(`app${i}`)
      clock += 1
    }
    const names = activity.snapshot().clients.map((c) => c.name)
    expect(names).toHaveLength(8)
    expect(names).not.toContain('app0')
    expect(names[0]).toBe('app8')
  })

  test('use the name from initialize for later requests with the same token', () => {
    activity.seen('claude-code')
    activity.named('claude-code', { name: 'claude-ai', title: 'Claude Code', version: '2.0.14' })
    activity.seen('claude-code')
    expect(activity.snapshot().clients).toEqual([
      { name: 'Claude Code', version: '2.0.14', lastSeenAt: clock },
    ])
    const id = activity.start('claude-code', 'get_graph')
    expect(activity.snapshot().calls[0]?.client).toBe('Claude Code')
    activity.end(id, 'ok')
  })

  test('fall back to the name when there is no title', () => {
    activity.named('node', { name: 'test-client', version: '1' })
    expect(activity.snapshot().clients[0]?.name).toBe('test-client')
  })

  test('have their names trimmed to 64 characters and stripped of control characters', () => {
    activity.named('x', { name: `  a\u0000b\u001b[31m${'z'.repeat(100)}\n`, version: '1\u0007' })
    const client = activity.snapshot().clients[0]
    expect(client?.name).toHaveLength(64)
    expect(client?.name.startsWith('ab[31mz')).toBe(true)
    expect(client?.version).toBe('1')
  })

  test('keep the token when the given name is empty', () => {
    activity.named('node', { name: ' \u0001 ', version: '1' })
    expect(activity.snapshot().clients[0]?.name).toBe('node')
  })
})

describe('calls', () => {
  test('run, then end with each outcome', () => {
    activity.seen('a')
    const ok = activity.start('a', 'one')
    expect(activity.snapshot().calls[0]).toMatchObject({
      tool: 'one',
      client: 'a',
      outcome: 'running',
      endedAt: null,
      startedAt: clock,
    })
    clock += 500
    activity.end(ok, 'ok')
    expect(activity.snapshot().calls[0]).toMatchObject({ outcome: 'ok', endedAt: clock })
    activity.end(activity.start('a', 'two'), 'refused')
    activity.end(activity.start('a', 'three'), 'error')
    expect(activity.snapshot().calls.map((c) => [c.tool, c.outcome])).toEqual([
      ['three', 'error'],
      ['two', 'refused'],
      ['one', 'ok'],
    ])
  })

  test('keep the last 5, newest first', () => {
    for (let i = 0; i < 7; i++) activity.end(activity.start('a', `tool${i}`), 'ok')
    expect(activity.snapshot().calls.map((c) => c.tool)).toEqual([
      'tool6',
      'tool5',
      'tool4',
      'tool3',
      'tool2',
    ])
  })

  test('ending a call that fell off the record does nothing', () => {
    const first = activity.start('a', 'first')
    for (let i = 0; i < 5; i++) activity.start('a', `later${i}`)
    broadcasts = []
    activity.end(first, 'ok')
    expect(broadcasts).toEqual([])
  })
})

describe('clear', () => {
  test('empties the record and tells the window', () => {
    activity.seen('a')
    activity.end(activity.start('a', 'tool'), 'ok')
    broadcasts = []
    activity.clear()
    expect(activity.snapshot()).toEqual({ clients: [], calls: [] })
    expect(broadcasts).toEqual([{ clients: [], calls: [] }])
  })

  test('says nothing when there was nothing', () => {
    activity.clear()
    expect(broadcasts).toEqual([])
  })

  test('lets a call that was running end quietly', () => {
    const id = activity.start('a', 'tool')
    activity.clear()
    broadcasts = []
    activity.end(id, 'ok')
    expect(activity.snapshot().calls).toEqual([])
    expect(broadcasts).toEqual([])
  })
})

describe('broadcasts', () => {
  test('come at once for a new client, a start, an end and a name', () => {
    activity.seen('a')
    expect(broadcasts).toHaveLength(1)
    const id = activity.start('a', 'tool')
    expect(broadcasts).toHaveLength(2)
    activity.end(id, 'ok')
    expect(broadcasts).toHaveLength(3)
    activity.named('a', { name: 'A', version: null })
    expect(broadcasts).toHaveLength(4)
  })

  test('are throttled to one per 5 s while only lastSeenAt moves', () => {
    activity.seen('a')
    broadcasts = []
    clock += 1000
    activity.seen('a')
    clock += 3000
    activity.seen('a')
    expect(broadcasts).toHaveLength(0)
    clock += 1000
    activity.seen('a')
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]?.clients[0]?.lastSeenAt).toBe(clock)
  })

  test('come at once when a client is seen again after the connected window lapsed', () => {
    activity.seen('a')
    clock += 16 * 60 * 1000
    broadcasts = []
    activity.seen('a')
    expect(broadcasts).toHaveLength(1)
  })
})

describe('privacy', () => {
  test('a snapshot holds only names, times, ids and outcomes', () => {
    const MARKER = 'SECRET-MARKER-42'
    // The record takes no arguments and no error text, so there is nowhere to put them; this
    // guards against a field that would carry them being added.
    const record = activity as unknown as {
      start: (...args: unknown[]) => number
      end: (...args: unknown[]) => void
    }
    activity.seen('a')
    const id = record.start('a', 'tool', { path: MARKER }, MARKER)
    record.end(id, 'error', MARKER, { error: MARKER })
    const serialized = JSON.stringify([activity.snapshot(), broadcasts])
    expect(serialized).not.toContain(MARKER)
    expect(Object.keys(activity.snapshot().calls[0] ?? {}).sort()).toEqual([
      'client',
      'endedAt',
      'id',
      'outcome',
      'startedAt',
      'tool',
    ])
    expect(Object.keys(activity.snapshot().clients[0] ?? {}).sort()).toEqual([
      'lastSeenAt',
      'name',
      'version',
    ])
  })
})
