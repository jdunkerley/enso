import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EngineLogChannel } from '../../engineLogs/channel.js'
import { EngineLogHub } from '../../engineLogs/hub.js'
import {
  handleEngineLogStream,
  isEngineLogStreamRequest,
  type EngineLogStreamOptions,
  type EventStreamRequest,
  type EventStreamResponse,
} from '../engineLogs.js'

class FakeRequest extends EventEmitter implements EventStreamRequest {
  destroyed = false
  constructor(
    readonly url: string,
    readonly method = 'GET',
  ) {
    super()
  }
}

class FakeResponse extends EventEmitter implements EventStreamResponse {
  destroyed = false
  status: number | undefined
  headers: Record<string, string> = {}
  readonly chunks: string[] = []
  ended = false
  /** Make every write throw, as a socket that is already gone does. */
  failWrites = false

  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    this.headers = headers
    return this
  }
  flushHeaders() {}
  write(chunk: string) {
    if (this.failWrites || this.ended) throw new Error('write after end')
    this.chunks.push(chunk)
    return true
  }
  end(chunk?: string) {
    if (chunk != null) this.chunks.push(chunk)
    this.ended = true
    return this
  }
  get body() {
    return this.chunks.join('')
  }
  /** The events written, as `[name, data]`. */
  events(): [string, unknown][] {
    return this.body
      .split('\n\n')
      .filter((block) => block.startsWith('event: '))
      .map((block) => {
        const [eventLine = '', dataLine = ''] = block.split('\n')
        return [eventLine.slice('event: '.length), JSON.parse(dataLine.slice('data: '.length))]
      })
  }
}

const HEADERS = { 'Cross-Origin-Resource-Policy': 'same-origin' }

let root: string
let projectPath: string
let hub: EngineLogHub
let channel: EngineLogChannel

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-log-stream-'))
  projectPath = path.join(root, 'Project')
  hub = new EngineLogHub({ pollMs: 20 })
  channel = hub.open({
    projectPath,
    logDirectory: path.join(root, 'logs', 'key'),
    localProjectKey: 'key',
  })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await channel.close()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The query naming the project as the GUI does: its asset id, `project-<encoded path>`. */
function projectQuery(extra = '') {
  return `${new URLSearchParams({ project: `project-${encodeURIComponent(projectPath)}` })}${extra}`
}

/** Open a stream on `streamHub`. There is deliberately no default, so `undefined` stays `undefined`. */
function openOn(
  streamHub: EngineLogHub | undefined,
  query: string,
  options: EngineLogStreamOptions = {},
  method = 'GET',
) {
  const request = new FakeRequest(`/api/engine-logs/stream?${query}`, method)
  const response = new FakeResponse()
  handleEngineLogStream(request, response, streamHub, HEADERS, options)
  return { request, response }
}

function open(query: string, options: EngineLogStreamOptions = {}, method = 'GET') {
  return openOn(hub, query, options, method)
}

describe('isEngineLogStreamRequest', () => {
  test('recognises the route, with or without a query', () => {
    expect(isEngineLogStreamRequest('/api/engine-logs/stream')).toBe(true)
    expect(isEngineLogStreamRequest('/api/engine-logs/stream?project=x')).toBe(true)
    expect(isEngineLogStreamRequest('/api/engine-logs')).toBe(false)
    expect(isEngineLogStreamRequest('/api/project-service/project/open')).toBe(false)
  })
})

describe('handleEngineLogStream', () => {
  test.each([
    ['a hub that does not hold the project', () => hub],
    ['no hub at all (no project service yet)', () => undefined],
  ])('answers %s with a stream that ends at once', (_, getHub) => {
    const { response } = openOn(
      getHub(),
      new URLSearchParams({ project: 'project-%2Fnowhere' }).toString(),
    )
    expect(response.status).toBe(200)
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(response.headers['Cache-Control']).toBe('no-cache, no-transform')
    expect(response.headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect(response.events()).toEqual([['end', { reason: 'not-open' }]])
    expect(response.ended).toBe(true)
  })

  test.each([
    ['no project', ''],
    ['the id of something other than a project', 'project=directory-%252Fx'],
    ['a negative `after`', 'project=project-x&after=-1'],
    ['a `after` that is not a number', 'project=project-x&after=soon'],
  ])('refuses %s', (_, query) => {
    const { response } = open(query)
    expect(response.status).toBe(400)
    expect(response.ended).toBe(true)
  })

  test('refuses anything but GET', () => {
    const { response } = open(projectQuery(), {}, 'POST')
    expect(response.status).toBe(405)
    expect(response.headers['Allow']).toBe('GET')
    expect(response.ended).toBe(true)
  })

  test('sends hello, then the buffered events, then live ones', () => {
    channel.engineStderr(Buffer.from('one\ntwo\n'))
    const { response } = open(projectQuery())
    expect(response.events()).toEqual([
      ['hello', { channel: channel.id, oldestSeq: 1, nextSeq: 3, sessionId: null, logFile: null }],
      ['line', { seq: 1, source: 'stderr', sessionId: null, text: 'one' }],
      ['line', { seq: 2, source: 'stderr', sessionId: null, text: 'two' }],
    ])
    channel.engineStderr(Buffer.from('three\n'))
    expect(response.events().at(-1)).toEqual([
      'line',
      { seq: 3, source: 'stderr', sessionId: null, text: 'three' },
    ])
    expect(response.ended).toBe(false)
  })

  test('resumes after `after` on the same channel, and replays everything for another', () => {
    channel.engineStderr(Buffer.from('1\n2\n3\n'))
    const resumed = open(projectQuery(`&channel=${channel.id}&after=2`)).response
    expect(resumed.events().map(([name, data]) => [name, (data as { seq?: number }).seq])).toEqual([
      ['hello', undefined],
      ['line', 3],
    ])
    const other = open(projectQuery('&channel=an-earlier-opening&after=2')).response
    expect(other.events().filter(([name]) => name === 'line')).toHaveLength(3)
  })

  test('ends the stream when the project closes', async () => {
    const { response } = open(projectQuery())
    await channel.close()
    expect(response.events().at(-1)).toEqual(['end', { reason: 'closed' }])
    expect(response.ended).toBe(true)
  })

  test('writes a heartbeat comment every 15 seconds until the client goes away', () => {
    vi.useFakeTimers()
    const { request, response } = open(projectQuery())
    vi.advanceTimersByTime(15_000)
    expect(response.body.endsWith(': heartbeat\n\n')).toBe(true)
    const written = response.chunks.length
    request.emit('close')
    vi.advanceTimersByTime(60_000)
    expect(response.chunks).toHaveLength(written)
  })

  test('sends nothing more to a client that went away', () => {
    const { request, response } = open(projectQuery())
    request.emit('close')
    channel.engineStderr(Buffer.from('unseen\n'))
    expect(response.body).not.toContain('unseen')
  })

  test('stops when the response closes, or when the request had closed before dispatch', () => {
    const first = open(projectQuery())
    first.response.emit('close')
    channel.engineStderr(Buffer.from('unseen\n'))
    expect(first.response.body).not.toContain('unseen')

    vi.useFakeTimers()
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const request = new FakeRequest(`/api/engine-logs/stream?${projectQuery()}`)
    request.destroyed = true
    const response = new FakeResponse()
    handleEngineLogStream(request, response, hub, HEADERS)
    const written = response.chunks.length
    channel.engineStderr(Buffer.from('later\n'))
    vi.advanceTimersByTime(60_000)
    expect(response.chunks).toHaveLength(written)
    expect(response.body).not.toContain('later')
    expect(clear).not.toHaveBeenCalledWith(undefined)
  })

  test('a write to a socket that is already gone does not throw out of the subscriber', () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response } = open(projectQuery())
    response.failWrites = true
    expect(() => channel.engineStderr(Buffer.from('lost\n'))).not.toThrow()
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
    // The failed write dropped the subscription: later events are not offered again.
    response.failWrites = false
    channel.engineStderr(Buffer.from('later\n'))
    expect(response.body).not.toContain('later')
    expect(error).not.toHaveBeenCalled()
  })
})
