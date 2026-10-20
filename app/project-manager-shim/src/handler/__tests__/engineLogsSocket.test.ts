import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EngineLogChannel, EngineLogSubscription } from '../../engineLogs/channel.js'
import { EngineLogHub } from '../../engineLogs/hub.js'
import { handleEngineLogStream, isEngineLogStreamRequest } from '../engineLogs.js'

let root: string
let projectPath: string
let hub: EngineLogHub
let channel: EngineLogChannel
let server: http.Server
let port: number
let client: http.ClientRequest | undefined

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-log-socket-'))
  projectPath = path.join(root, 'Project')
  hub = new EngineLogHub({ pollMs: 20 })
  channel = hub.open({
    projectPath,
    logDirectory: path.join(root, 'logs', 'key'),
    localProjectKey: 'key',
  })
  server = http.createServer((request, response) => {
    if (isEngineLogStreamRequest(request.url ?? '')) {
      handleEngineLogStream(request, response, hub, {}, { heartbeatMs: 60_000 })
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  vi.restoreAllMocks()
  client?.destroy()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await channel.close()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Resolves once `predicate` holds for what the client has received so far. */
function receiveUntil(received: { text: string }, predicate: (text: string) => boolean) {
  return vi.waitFor(() => expect(predicate(received.text)).toBe(true), { timeout: 5_000 })
}

describe('the engine log stream over a real socket', () => {
  test('flushes events while open, and cleans up when the client goes away', async () => {
    const unsubscribed = vi.fn()
    const subscribe = channel.subscribe.bind(channel)
    vi.spyOn(channel, 'subscribe').mockImplementation((...args): EngineLogSubscription => {
      const subscription = subscribe(...args)
      return {
        ...subscription,
        unsubscribe: () => {
          unsubscribed()
          subscription.unsubscribe()
        },
      }
    })
    const cleared = vi.spyOn(globalThis, 'clearInterval')

    const received = { text: '' }
    const project = `project-${encodeURIComponent(projectPath)}`
    const url = `http://127.0.0.1:${port}/api/engine-logs/stream?${new URLSearchParams({ project })}`
    const connected = new Promise<http.IncomingMessage>((resolve, reject) => {
      client = http.get(url, resolve).on('error', reject)
    })
    const response = await connected
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => (received.text += chunk))

    // The response is still open: these frames can only arrive if each write is flushed.
    await receiveUntil(received, (text) => text.includes('event: hello\n'))
    channel.engineStderr(Buffer.from('over the wire\n'))
    await receiveUntil(received, (text) => text.includes('"text":"over the wire"'))
    expect(received.text).toMatch(/event: line\ndata: \{"seq":1,/)
    expect(response.complete).toBe(false)
    expect(unsubscribed).not.toHaveBeenCalled()

    client?.destroy()
    await vi.waitFor(() => expect(unsubscribed).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    expect(cleared).toHaveBeenCalled()
    // Nothing is subscribed any more, so another line goes nowhere and does not throw.
    expect(() => channel.engineStderr(Buffer.from('after\n'))).not.toThrow()
  })
})
