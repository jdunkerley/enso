/* eslint-disable camelcase -- tool names and argument names are snake_case on the wire */
import type { McpToolCallReply, McpToolCallRequest } from 'enso-common/src/mcp'
import { afterEach, expect, test, vi } from 'vitest'
import {
  activeProjectToolsId,
  NO_PROJECT_ERROR,
  pendingProjectToolsWaits,
  registerMcpAppToolHandlers,
  registerMcpToolHandlers,
  startMcpToolDispatcher,
  whenProjectToolsActive,
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

function register(handlers: Record<string, McpToolHandler>, projectId = 'P') {
  const registration = registerMcpToolHandlers(handlers, () => projectId)
  cleanups.push(registration.remove)
  return registration
}

/** A registration whose `get_graph` answers `name`. */
function project(name: string) {
  return register({ get_graph: async () => ({ ok: true, value: name }) }, name)
}

let nextId = 0
async function graphFrom(call: (request: McpToolCallRequest) => Promise<McpToolCallReply>) {
  return (await call({ requestId: `g${nextId++}`, tool: 'get_graph', args: {}, caller })).result
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

test('Removing a registration removes only the handlers it registered', async () => {
  const { call } = start()
  const a = project('A')
  project('B')
  a.remove()
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'B' })
})

test('The most recently registered project answers; removing it falls back', async () => {
  const { call } = start()
  project('A')
  const b = project('B')
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'B' })
  b.remove()
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'A' })
})

test('A project activated again answers while a later one is registered', async () => {
  const { call } = start()
  const a = project('A')
  project('B')
  a.activate()
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'A' })
})

test('A removed (deactivated) project does not answer, and activating it restores it', async () => {
  const { call } = start()
  const a = project('A')
  const b = project('B')
  b.remove()
  a.remove()
  expect(await graphFrom(call)).toEqual({ ok: false, error: NO_PROJECT_ERROR })
  b.activate()
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'B' })
})

test('Stopping the dispatcher unsubscribes from the api', () => {
  const fake = fakeApi()
  const stop = startMcpToolDispatcher(fake.api)
  expect(fake.unsubscribe).not.toHaveBeenCalled()
  stop()
  expect(fake.unsubscribe).toHaveBeenCalledOnce()
})

// === App tools ===

/** App handlers registered as the app shell registers them: once, whatever page shows. */
function app(handlers: Record<string, McpToolHandler>) {
  const unregister = registerMcpAppToolHandlers(handlers)
  cleanups.push(unregister)
  return unregister
}

test('App tools answer on the dashboard, while project tools there still say no project is open', async () => {
  const { call } = start()
  app({ get_app_state: async () => ({ ok: true, value: 'dashboard' }) })
  expect((await call({ requestId: 'a1', tool: 'get_app_state', args: {}, caller })).result).toEqual(
    { ok: true, value: 'dashboard' },
  )
  expect(await graphFrom(call)).toEqual({ ok: false, error: NO_PROJECT_ERROR })
})

test('App tools answer whichever project is on screen or hidden', async () => {
  const { call } = start()
  app({ get_app_state: async () => ({ ok: true, value: 'app' }) })
  const a = project('A')
  const appState = async () =>
    (await call({ requestId: `s${nextId++}`, tool: 'get_app_state', args: {}, caller })).result
  expect(await appState()).toEqual({ ok: true, value: 'app' })
  expect(await graphFrom(call)).toEqual({ ok: true, value: 'A' })
  a.remove()
  expect(await appState()).toEqual({ ok: true, value: 'app' })
  expect(await graphFrom(call)).toEqual({ ok: false, error: NO_PROJECT_ERROR })
})

test('App tools do not count as a project being shown', () => {
  app({ get_app_state: async () => ({ ok: true, value: 'app' }) })
  expect(activeProjectToolsId()).toBeUndefined()
  const a = project('A')
  expect(activeProjectToolsId()).toBe('A')
  a.remove()
  expect(activeProjectToolsId()).toBeUndefined()
})

test('Unregistering the app tools stops them answering', async () => {
  const { call } = start()
  const unregister = app({ list_projects: async () => ({ ok: true, value: '[]' }) })
  unregister()
  expect((await call({ requestId: 'a2', tool: 'list_projects', args: {}, caller })).result).toEqual(
    { ok: false, error: NO_PROJECT_ERROR },
  )
})

// === Waiting for a project's tools ===

test('activeProjectToolsId is the project whose handlers answer', () => {
  const a = project('A')
  const b = project('B')
  expect(activeProjectToolsId()).toBe('B')
  a.activate()
  expect(activeProjectToolsId()).toBe('A')
  a.remove()
  expect(activeProjectToolsId()).toBe('B')
  b.remove()
  expect(activeProjectToolsId()).toBeUndefined()
})

test('Waiting for B does not resolve when A activates, and resolves when B does', async () => {
  let settled: boolean | undefined
  void whenProjectToolsActive('B', 10_000).then((value) => (settled = value))
  project('A')
  await Promise.resolve()
  expect(settled).toBeUndefined()
  const b = project('B')
  await vi.waitFor(() => expect(settled).toBe(true))
  b.remove()
})

test('Waiting resolves when a removed project is activated again', async () => {
  project('A')
  const b = project('B')
  b.remove()
  const active = whenProjectToolsActive('B', 10_000)
  b.activate()
  await expect(active).resolves.toBe(true)
})

test('Waiting resolves when removing another project leaves this one answering', async () => {
  project('B')
  const a = project('A')
  const active = whenProjectToolsActive('B', 10_000)
  a.remove()
  await expect(active).resolves.toBe(true)
})

test('Concurrent waits for different projects each resolve on their own project', async () => {
  const settled: Record<string, boolean> = {}
  void whenProjectToolsActive('A', 10_000).then((value) => (settled.A = value))
  void whenProjectToolsActive('B', 10_000).then((value) => (settled.B = value))
  project('A')
  await vi.waitFor(() => expect(settled).toEqual({ A: true }))
  project('B')
  await vi.waitFor(() => expect(settled).toEqual({ A: true, B: true }))
  expect(pendingProjectToolsWaits()).toBe(0)
})

test('The fast path: a wait for the project already answering resolves at once', async () => {
  project('B')
  await expect(whenProjectToolsActive('B', 10_000)).resolves.toBe(true)
  expect(pendingProjectToolsWaits()).toBe(0)
})

test('The fast path is false when A answers and B is asked for', async () => {
  vi.useFakeTimers()
  try {
    project('A')
    expect(activeProjectToolsId()).not.toBe('B')
    const active = whenProjectToolsActive('B', 1_000)
    let settled: boolean | undefined
    void active.then((value) => (settled = value))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('A wait times out to false and leaves no listener behind', async () => {
  vi.useFakeTimers()
  try {
    const active = whenProjectToolsActive('B', 1_000)
    expect(pendingProjectToolsWaits()).toBe(1)
    let settled: boolean | undefined
    void active.then((value) => (settled = value))
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    expect(pendingProjectToolsWaits()).toBe(0)
    // A later activation of B finds nothing waiting.
    project('B')
    expect(settled).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

test('A deactivated project never answers, and is not waited into answering', async () => {
  const { call } = start()
  const b = project('B')
  b.remove()
  expect(activeProjectToolsId()).toBeUndefined()
  expect(await graphFrom(call)).toEqual({ ok: false, error: NO_PROJECT_ERROR })
})

test('Waiting is not resolved by the app tools registering', async () => {
  vi.useFakeTimers()
  try {
    const active = whenProjectToolsActive('B', 1_000)
    app({ get_app_state: async () => ({ ok: true, value: 'app' }) })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(active).resolves.toBe(false)
  } finally {
    vi.useRealTimers()
  }
})
