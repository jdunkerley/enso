/** @file Unit tests for the MCP window bridge and the project tool definitions. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolCallRequest } from 'enso-common/src/mcp'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Channel } from '../../src/ipc'
import { APP_TOOL_NAMES, appTools } from '../../src/mcp/appTools'
import {
  EDIT_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  VIEW_TOOL_NAMES,
  projectTools,
} from '../../src/mcp/projectTools'
import { ToolRegistry } from '../../src/mcp/toolRegistry'
import {
  EDIT_TOOL_TIMEOUT_MS,
  OPEN_TOOL_TIMEOUT_MS,
  WINDOW_TOOL_TIMEOUT_MS,
  WindowBridge,
  type WindowTarget,
} from '../../src/mcp/windowBridge'

const caller: McpCaller = { kind: 'external', name: 'test-client' }

function fakeWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, send: vi.fn() } satisfies WindowTarget
}

function setup(win: WindowTarget | null = fakeWindow()) {
  const ipc = new EventEmitter()
  const bridge = new WindowBridge(
    () => win,
    ipc as unknown as Pick<Electron.IpcMain, 'on' | 'removeListener'>,
  )
  return { ipc, bridge }
}

function sentRequest(win: ReturnType<typeof fakeWindow>): McpToolCallRequest {
  expect(win.send).toHaveBeenCalledTimes(1)
  const [channel, request] = win.send.mock.calls[0] as [string, McpToolCallRequest]
  expect(channel).toBe(Channel.mcpToolCall)
  return request
}

describe('WindowBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('sends the call and resolves with the window reply', async () => {
    const win = fakeWindow()
    const { ipc, bridge } = setup(win)
    const pending = bridge.call('get_node', { node_id: 'a' }, caller)
    const request = sentRequest(win)
    expect(request).toEqual({
      requestId: expect.any(String),
      tool: 'get_node',
      args: { node_id: 'a' },
      caller,
      timeoutMs: WINDOW_TOOL_TIMEOUT_MS,
    })
    ipc.emit(Channel.mcpToolReply, undefined, {
      requestId: request.requestId,
      result: { ok: true, value: 'node' },
    })
    await expect(pending).resolves.toEqual({ ok: true, value: 'node' })
  })

  test('ignores a reply for another request', async () => {
    const win = fakeWindow()
    const { ipc, bridge } = setup(win)
    const pending = bridge.call('get_graph', {}, caller)
    const request = sentRequest(win)
    ipc.emit(Channel.mcpToolReply, undefined, {
      requestId: 'other',
      result: { ok: true, value: 'wrong' },
    })
    ipc.emit(Channel.mcpToolReply, undefined, {
      requestId: request.requestId,
      result: { ok: true, value: 'right' },
    })
    await expect(pending).resolves.toEqual({ ok: true, value: 'right' })
  })

  test('ignores a reply that is not well formed', async () => {
    const win = fakeWindow()
    const { ipc, bridge } = setup(win)
    const pending = bridge.call('get_graph', {}, caller)
    const { requestId } = sentRequest(win)
    for (const reply of [
      null,
      'text',
      { requestId: 42, result: { ok: true, value: 'v' } },
      { requestId },
      { requestId, result: null },
      { requestId, result: { ok: true, value: 42 } },
      { requestId, result: { ok: true } },
      { requestId, result: { ok: false, error: { message: 'no' } } },
      { requestId, result: { ok: 'yes', value: 'v' } },
    ]) {
      ipc.emit(Channel.mcpToolReply, undefined, reply)
    }
    ipc.emit(Channel.mcpToolReply, undefined, {
      requestId,
      result: { ok: false, error: 'the real one' },
    })
    await expect(pending).resolves.toEqual({ ok: false, error: 'the real one' })
  })

  test('errors when there is no window', async () => {
    const { bridge } = setup(null)
    const result = await bridge.call('get_graph', {}, caller)
    expect(!result.ok && result.error).toContain('No Enso window')
  })

  test('errors when the window is destroyed', async () => {
    const win = fakeWindow(true)
    const { bridge } = setup(win)
    const result = await bridge.call('get_graph', {}, caller)
    expect(!result.ok && result.error).toContain('No Enso window')
    expect(win.send).not.toHaveBeenCalled()
  })

  test('times out without a reply', async () => {
    const { bridge } = setup()
    const pending = bridge.call('get_graph', {}, caller)
    await vi.advanceTimersByTimeAsync(WINDOW_TOOL_TIMEOUT_MS)
    const result = await pending
    expect(!result.ok && result.error).toContain('timed out')
  })

  test('times out at the given timeout, not at the default', async () => {
    const { bridge } = setup()
    let settled = false
    const pending = bridge.call('add_nodes', {}, caller, EDIT_TOOL_TIMEOUT_MS).then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(WINDOW_TOOL_TIMEOUT_MS)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(EDIT_TOOL_TIMEOUT_MS - WINDOW_TOOL_TIMEOUT_MS)
    const result = await pending
    expect(!result.ok && result.error).toContain('timed out after 60000ms')
  })

  test('sends the timeout with the call, so that the window can refuse an edit too late to run', () => {
    const win = fakeWindow()
    const { bridge } = setup(win)
    void bridge.call('add_nodes', {}, caller, EDIT_TOOL_TIMEOUT_MS)
    expect(sentRequest(win).timeoutMs).toBe(EDIT_TOOL_TIMEOUT_MS)
  })

  test('dispose resolves pending calls with an error and removes the listener', async () => {
    const { ipc, bridge } = setup()
    const pending = bridge.call('get_graph', {}, caller)
    expect(ipc.listenerCount(Channel.mcpToolReply)).toBe(1)
    bridge.dispose()
    expect((await pending).ok).toBe(false)
    expect(ipc.listenerCount(Channel.mcpToolReply)).toBe(0)
  })
})

describe('projectTools', () => {
  test('defines the view tools, then the edit tools, in order', () => {
    const tools = projectTools({ call: vi.fn() })
    expect(tools.map((t) => t.name)).toEqual([...PROJECT_TOOL_NAMES])
    expect(PROJECT_TOOL_NAMES).toEqual([...VIEW_TOOL_NAMES, ...EDIT_TOOL_NAMES])
    expect(VIEW_TOOL_NAMES).toEqual([
      'get_graph',
      'get_node',
      'search_components',
      'get_component_docs',
      'evaluate_expression',
      'list_visualizations',
    ])
    expect(EDIT_TOOL_NAMES).toEqual([
      'add_nodes',
      'edit_node',
      'remove_nodes',
      'collapse_nodes',
      'add_function',
      'set_node_comment',
      'set_visualization',
      'select_nodes',
      'open_method',
    ])
  })

  test('forwards every tool under its own name and timeout', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: 'v' }))
    const quick = new Set<string>([...VIEW_TOOL_NAMES, 'select_nodes', 'open_method'])
    for (const tool of projectTools({ call })) {
      call.mockClear()
      await tool.run({ marker: 1 }, caller)
      const timeout = quick.has(tool.name) ? WINDOW_TOOL_TIMEOUT_MS : EDIT_TOOL_TIMEOUT_MS
      expect(call).toHaveBeenCalledWith(tool.name, { marker: 1 }, caller, timeout)
    }
  })

  test('forwards a call to the bridge', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: 'v' }))
    const getNode = projectTools({ call }).find((t) => t.name === 'get_node')!
    await expect(getNode.run({ node_id: 'a' }, caller)).resolves.toEqual({ ok: true, value: 'v' })
    expect(call).toHaveBeenCalledWith('get_node', { node_id: 'a' }, caller, WINDOW_TOOL_TIMEOUT_MS)
  })
})

describe('projectTools argument bounds', () => {
  const registry = new ToolRegistry()
  for (const tool of projectTools({ call: async () => ({ ok: true, value: 'v' }) })) {
    registry.register(tool)
  }
  test.each([
    ['get_node', 'node_id', 200, {}],
    ['get_component_docs', 'name', 200, {}],
    ['search_components', 'self_type', 200, { query: 'q' }],
    ['search_components', 'query', 500, {}],
    ['evaluate_expression', 'expression', 100_000, {}],
    ['evaluate_expression', 'node_id', 200, { expression: '1' }],
  ] as const)('%s takes %s of at most %i characters', async (tool, arg, max, rest) => {
    const ok = await registry.call(tool, { ...rest, [arg]: 'x'.repeat(max) }, caller)
    expect(ok).toEqual({ ok: true, value: 'v' })
    const tooLong = await registry.call(tool, { ...rest, [arg]: 'x'.repeat(max + 1) }, caller)
    expect(tooLong.ok).toBe(false)
  })
})

describe('edit tool arguments', () => {
  const registry = new ToolRegistry()
  for (const tool of projectTools({ call: async () => ({ ok: true, value: 'v' }) })) {
    registry.register(tool)
  }
  const ok = async (tool: string, args: Record<string, unknown>) =>
    (await registry.call(tool, args, caller)).ok
  const statements = (n: number) => Array.from({ length: n }, () => 'x = 1')

  test('add_nodes takes 1 to 50 statements', async () => {
    expect(await ok('add_nodes', { statements: statements(50) })).toBe(true)
    expect(await ok('add_nodes', { statements: statements(51) })).toBe(false)
    expect(await ok('add_nodes', { statements: [] })).toBe(false)
    expect(await ok('add_nodes', { statements: [''] })).toBe(false)
  })

  test('add_nodes takes an optional after_node and up to 20 imports', async () => {
    const args = { statements: ['a = 1'], after_node: 'id', imports: ['from A import B'] }
    expect(await ok('add_nodes', args)).toBe(true)
    const imports = Array.from({ length: 21 }, () => 'import A')
    expect(await ok('add_nodes', { statements: ['a = 1'], imports })).toBe(false)
  })

  test('remove_nodes and collapse_nodes need 1 to 200 node ids', async () => {
    for (const tool of ['remove_nodes', 'collapse_nodes']) {
      expect(await ok(tool, { node_ids: [] })).toBe(false)
      expect(await ok(tool, { node_ids: ['a'] })).toBe(true)
      expect(await ok(tool, { node_ids: Array.from({ length: 201 }, () => 'a') })).toBe(false)
    }
  })

  test('select_nodes accepts an empty list', async () => {
    expect(await ok('select_nodes', { node_ids: [] })).toBe(true)
  })

  test('a node id of 300 characters is refused', async () => {
    const id = 'x'.repeat(300)
    expect(await ok('edit_node', { node_id: id, expression: '1' })).toBe(false)
    expect(await ok('open_method', { node_id: id })).toBe(false)
    expect(await ok('open_method', {})).toBe(true)
  })

  test('set_visualization needs a boolean', async () => {
    expect(await ok('set_visualization', { node_id: 'a', visible: 'yes' })).toBe(false)
    expect(await ok('set_visualization', { node_id: 'a', visible: true })).toBe(true)
  })
})

describe('appTools', () => {
  test('defines the app tools in order', () => {
    const tools = appTools({ call: vi.fn() })
    expect(tools.map((t) => t.name)).toEqual([...APP_TOOL_NAMES])
    expect(APP_TOOL_NAMES).toEqual([
      'get_app_state',
      'list_projects',
      'list_files',
      'create_project',
      'open_project',
      'close_project',
    ])
  })

  test('forwards each tool under its name and timeout', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: 'v' }))
    for (const tool of appTools({ call })) {
      call.mockClear()
      await tool.run({ marker: 1 }, caller)
      const open = tool.name === 'create_project' || tool.name === 'open_project'
      const timeout = open ? OPEN_TOOL_TIMEOUT_MS : WINDOW_TOOL_TIMEOUT_MS
      expect(call).toHaveBeenCalledWith(tool.name, { marker: 1 }, caller, timeout)
    }
  })

  test('validates arguments', async () => {
    const registry = new ToolRegistry()
    for (const tool of appTools({ call: async () => ({ ok: true, value: 'v' }) })) {
      registry.register(tool)
    }
    const ok = async (tool: string, args: Record<string, unknown>) =>
      (await registry.call(tool, args, caller)).ok
    expect(await ok('create_project', { name: '' })).toBe(false)
    expect(await ok('create_project', { name: 'P' })).toBe(true)
    expect(await ok('open_project', {})).toBe(false)
    expect(await ok('open_project', { path: '/p' })).toBe(true)
    expect(await ok('list_projects', { directory: 'x'.repeat(1001) })).toBe(false)
    expect(await ok('close_project', {})).toBe(true)
  })
})
