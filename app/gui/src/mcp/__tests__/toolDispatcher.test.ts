/* eslint-disable camelcase -- tool names and argument names are snake_case on the wire */
import type { McpToolCallReply, McpToolCallRequest } from 'enso-common/src/mcp'
import { afterEach, expect, test, vi } from 'vitest'
import {
  NO_PROJECT_ERROR,
  registerMcpToolHandlers,
  startMcpToolDispatcher,
  type McpToolHandler,
} from '../toolDispatcher'

/** A fake `window.api.mcp`: keeps the dispatcher's handler and records the replies. */
function fakeApi() {
  let onCall: ((request: McpToolCallRequest) => void) | undefined
  const replies: McpToolCallReply[] = []
  const unsubscribe = vi.fn()
  const api = {
    onToolCall: (handler: (request: McpToolCallRequest) => void) => {
      onCall = handler
      return unsubscribe
    },
    replyToolCall: (reply: McpToolCallReply) => {
      replies.push(reply)
    },
  }
  /** Sends a call and waits until the dispatcher has replied to it. */
  async function call(request: McpToolCallRequest): Promise<McpToolCallReply> {
    onCall!(request)
    await vi.waitFor(() =>
      expect(replies.some((r) => r.requestId === request.requestId)).toBe(true),
    )
    return replies.find((r) => r.requestId === request.requestId)!
  }
  return { api, call, unsubscribe }
}

const caller = { kind: 'external', name: 'claude-code' } as const
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function start() {
  const fake = fakeApi()
  cleanups.push(startMcpToolDispatcher(fake.api))
  return fake
}

function register(handlers: Record<string, McpToolHandler>) {
  const dispose = registerMcpToolHandlers(handlers)
  cleanups.push(dispose)
  return dispose
}

test('A registered handler gets the arguments and caller, and its result is the reply', async () => {
  const { call } = start()
  const handler = vi.fn<McpToolHandler>(async () => ({ ok: true, value: 'graph' }))
  register({ get_graph: handler })
  const reply = await call({
    requestId: 'r1',
    tool: 'get_graph',
    args: { previews: false },
    caller,
  })
  expect(handler).toHaveBeenCalledWith({ previews: false }, caller)
  expect(reply).toEqual({ requestId: 'r1', result: { ok: true, value: 'graph' } })
})

test('A tool with no handler says that no project is open', async () => {
  const { call } = start()
  const reply = await call({ requestId: 'r2', tool: 'get_graph', args: {}, caller })
  expect(reply).toEqual({ requestId: 'r2', result: { ok: false, error: NO_PROJECT_ERROR } })
})

test('A handler that throws is answered with its message', async () => {
  const { call } = start()
  register({
    get_node: async () => {
      throw new Error('boom')
    },
  })
  const reply = await call({ requestId: 'r3', tool: 'get_node', args: {}, caller })
  expect(reply.result.ok).toBe(false)
  expect(reply.result.ok ? undefined : reply.result.error).toContain('boom')
})

test('Disposing a registration removes only the handlers it registered', async () => {
  const { call } = start()
  const disposeA = register({ get_graph: async () => ({ ok: true, value: 'A' }) })
  register({ get_graph: async () => ({ ok: true, value: 'B' }) })
  disposeA()
  const reply = await call({ requestId: 'r4', tool: 'get_graph', args: {}, caller })
  expect(reply.result).toEqual({ ok: true, value: 'B' })
})

test('Stopping the dispatcher unsubscribes from the api', () => {
  const fake = fakeApi()
  const stop = startMcpToolDispatcher(fake.api)
  expect(fake.unsubscribe).not.toHaveBeenCalled()
  stop()
  expect(fake.unsubscribe).toHaveBeenCalledOnce()
})
