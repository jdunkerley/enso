/** @file Unit tests for the MCP tool registry. */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, type ToolDefinition } from '../../src/mcp/toolRegistry'

const caller: McpCaller = { kind: 'external', name: 'test-client' }

function tool(
  name: string,
  run: ToolDefinition['run'] = () => Promise.resolve({ ok: true, value: name }),
): ToolDefinition {
  return {
    name,
    title: name,
    description: `The ${name} tool`,
    inputSchema: { count: z.number().int() },
    run,
  }
}

describe('ToolRegistry', () => {
  test('lists tools in registration order', () => {
    const registry = new ToolRegistry()
    registry.register(tool('b'))
    registry.register(tool('a'))
    expect(registry.list().map((t) => t.name)).toEqual(['b', 'a'])
  })

  test('refuses a duplicate name', () => {
    const registry = new ToolRegistry()
    registry.register(tool('a'))
    expect(() => registry.register(tool('a'))).toThrow(/a/)
  })

  test('an unknown tool is an error result', async () => {
    const registry = new ToolRegistry()
    await expect(registry.call('x', {}, caller)).resolves.toEqual({
      ok: false,
      error: "Unknown tool 'x'",
    })
  })

  test('invalid args name the field and do not run the tool', async () => {
    const registry = new ToolRegistry()
    const run = vi.fn()
    registry.register(tool('a', run))
    const result = await registry.call('a', { count: 'many' }, caller)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('count')
    expect(run).not.toHaveBeenCalled()
  })

  test('an extra key is rejected', async () => {
    const registry = new ToolRegistry()
    const run = vi.fn()
    registry.register(tool('a', run))
    const result = await registry.call('a', { count: 1, extra: true }, caller)
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  test('passes parsed args and the caller to run and returns its result', async () => {
    const registry = new ToolRegistry()
    const reply: McpToolResult = { ok: true, value: 'done' }
    const run = vi.fn(() => Promise.resolve(reply))
    registry.register(tool('a', run))
    await expect(registry.call('a', { count: 3 }, caller)).resolves.toBe(reply)
    expect(run).toHaveBeenCalledWith({ count: 3 }, caller)
  })

  test('a throwing run becomes an error result', async () => {
    const registry = new ToolRegistry()
    registry.register(tool('a', () => Promise.reject(new Error('boom'))))
    await expect(registry.call('a', { count: 1 }, caller)).resolves.toEqual({
      ok: false,
      error: 'boom',
    })
  })
})
