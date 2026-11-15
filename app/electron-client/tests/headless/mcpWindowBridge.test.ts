/** @file Unit tests for the MCP window bridge and the project tool definitions. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolCallRequest } from 'enso-common/src/mcp'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Channel } from '../../src/ipc'
import { PROJECT_TOOL_NAMES, projectTools } from '../../src/mcp/projectTools'
import { WINDOW_TOOL_TIMEOUT_MS, WindowBridge, type WindowTarget } from '../../src/mcp/windowBridge'

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
  test('defines the five tools in order', () => {
    const tools = projectTools({ call: vi.fn() })
    expect(tools.map((t) => t.name)).toEqual([...PROJECT_TOOL_NAMES])
    expect(PROJECT_TOOL_NAMES).toHaveLength(5)
  })

  test('forwards a call to the bridge', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: 'v' }))
    const getNode = projectTools({ call }).find((t) => t.name === 'get_node')!
    await expect(getNode.run({ node_id: 'a' }, caller)).resolves.toEqual({ ok: true, value: 'v' })
    expect(call).toHaveBeenCalledWith('get_node', { node_id: 'a' }, caller)
  })
})
