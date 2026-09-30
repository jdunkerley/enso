import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { YjsChannel } from 'ydoc-channel'
import * as Y from 'yjs'
import { LanguageServer } from '../languageServer'
import { YjsTransport } from '../util/net/YjsTransport'
import type { Uuid } from '../yjsModel'

// Polyfill DOM event types that are missing from some Node.js versions.
if (typeof globalThis.CloseEvent === 'undefined') {
  ;(globalThis as any).CloseEvent = class CloseEvent extends Event {}
}
if (typeof globalThis.MessageEvent === 'undefined') {
  ;(globalThis as any).MessageEvent = class MessageEvent extends Event {
    data: any
    constructor(type: string, options?: any) {
      super(type, options)
      this.data = options?.data
    }
  }
}
if (typeof globalThis.ErrorEvent === 'undefined') {
  ;(globalThis as any).ErrorEvent = class ErrorEvent extends Event {
    error: any
    message: string
    constructor(type: string, options?: any) {
      super(type, options)
      this.error = options?.error
      this.message = options?.message || ''
    }
  }
}

const CHANNEL = 'language-server'
const CLIENT_ID = '00000000-0000-0000-0000-000000000001' as Uuid
const INIT = 'session/initProtocolConnection'

/**
 * The Language Server side of the channel: records every request and answers each with an empty
 * success result.
 */
function fakeLanguageServer(doc: Y.Doc) {
  const channel = new YjsChannel<string>(doc, CHANNEL)
  const requests: string[] = []
  channel.subscribe((raw) => {
    const message = JSON.parse(raw)
    if (typeof message.method !== 'string') return
    requests.push(message.method)
    if (message.id == null) return
    const result = message.method === INIT ? { contentRoots: [] } : null
    queueMicrotask(() => channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })))
  })
  return { requests, initRequests: () => requests.filter((method) => method === INIT).length }
}

/** A transport whose `open` is only emitted when the test calls {@link open}. */
class DeferredOpenTransport extends YjsTransport {
  private pendingOpen: (() => void) | undefined
  override connect(): Promise<void> {
    return new Promise((resolve) => {
      this.pendingOpen = () => void super.connect().then(resolve)
    })
  }
  open() {
    const pendingOpen = this.pendingOpen
    this.pendingOpen = undefined
    pendingOpen?.()
  }
}

/**
 * A transport that can be connected again after {@link close}. `YjsTransport.close` closes its
 * channel for good, so the base class alone cannot model a reconnect.
 */
class ReopenableTransport extends YjsTransport {
  override connect(): Promise<void> {
    this.channel = new YjsChannel<string>(this.doc, this.channelName)
    return super.connect()
  }
}

describe('LanguageServer initialization', () => {
  let doc: Y.Doc
  let server: ReturnType<typeof fakeLanguageServer>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>
  let ls: LanguageServer | undefined

  beforeEach(() => {
    doc = new Y.Doc()
    server = fakeLanguageServer(doc)
    warn = vi.spyOn(console, 'warn')
    error = vi.spyOn(console, 'error')
  })

  afterEach(() => {
    ls?.stopReconnecting()
    ls?.release()
    ls = undefined
    vi.restoreAllMocks()
  })

  function connectedCounter(ls: LanguageServer) {
    let count = 0
    ls.on('transport/connected', () => (count += 1))
    return () => count
  }

  test('transport that opens while the client is being constructed', async () => {
    // `YjsTransport.connect` emits `open` synchronously, from inside `new RequestManager`.
    ls = new LanguageServer(CLIENT_ID, new YjsTransport(doc, CHANNEL))
    const result = await ls.initialized
    expect(result.ok).toBe(true)
    expect(server.initRequests()).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('transport that is already open at construction', async () => {
    const transport = new YjsTransport(doc, CHANNEL)
    await transport.connect()
    ls = new LanguageServer(CLIENT_ID, transport)
    const result = await ls.initialized
    expect(result.ok).toBe(true)
    expect(server.initRequests()).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('transport that opens after construction', async () => {
    const transport = new DeferredOpenTransport(doc, CHANNEL)
    ls = new LanguageServer(CLIENT_ID, transport)
    const connected = connectedCounter(ls)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(server.initRequests()).toBe(0)
    transport.open()
    const result = await ls.initialized
    expect(result.ok).toBe(true)
    expect(server.initRequests()).toBe(1)
    expect(connected()).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  test('re-initializes after the transport closes and opens again', async () => {
    const transport = new ReopenableTransport(doc, CHANNEL)
    ls = new LanguageServer(CLIENT_ID, transport)
    expect((await ls.initialized).ok).toBe(true)
    expect(server.initRequests()).toBe(1)

    const connected = connectedCounter(ls)
    let closed = 0
    ls.on('transport/closed', () => (closed += 1))
    transport.close()
    expect(closed).toBe(1)
    // Until the transport opens again, requests wait for the new initialization.
    let settled = false
    const reinitialized = ls.initialized.then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    await transport.connect()
    expect((await reinitialized).ok).toBe(true)
    expect(server.initRequests()).toBe(2)
    expect(connected()).toBe(1)
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
