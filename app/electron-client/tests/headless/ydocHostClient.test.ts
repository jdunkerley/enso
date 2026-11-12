/** @file The main process's end of the ydoc utility process (`src/ydocHost/client.ts`), against a fake child. */
import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'

import type { YdocListenRequest } from 'project-manager-shim/projectService'
import { UtilityProcessYdocHost, type YdocHostChild } from '../../src/ydocHost/client'
import type { YdocHostRequest, YdocHostResponse } from '../../src/ydocHost/protocol'

/** A fake utility process: records requests and answers them as `answer` says. */
class FakeChild extends EventEmitter implements YdocHostChild {
  readonly requests: YdocHostRequest[] = []
  killed = false
  constructor(private readonly answer: (r: YdocHostRequest) => YdocHostResponse | undefined) {
    super()
  }
  postMessage(message: YdocHostRequest): void {
    this.requests.push(message)
    const response = this.answer(message)
    if (response) queueMicrotask(() => this.emit('message', response))
  }
  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }
  /** The process dies on its own. */
  crash(): void {
    this.emit('exit', 1)
  }
}

const done = (r: YdocHostRequest): YdocHostResponse => ({ type: 'done', id: r.id })

const request = (port: number): YdocListenRequest => ({
  host: '127.0.0.1',
  port,
  languageServer: { host: '127.0.0.1', port: port + 1, token: 'a'.repeat(64) },
})

function setup(answer: (r: YdocHostRequest) => YdocHostResponse | undefined = done) {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const child = new FakeChild(answer)
    children.push(child)
    return child
  })
  const host = new UtilityProcessYdocHost(spawn)
  return { host, spawn, children }
}

test('nothing is forked until the first listen', () => {
  const { spawn } = setup()
  expect(spawn).not.toHaveBeenCalled()
})

test('start forks ahead of the first open, once', async () => {
  const { host, spawn } = setup()
  host.start()
  host.start()
  expect(spawn).toHaveBeenCalledOnce()
  await host.listen(request(4000))
  expect(spawn).toHaveBeenCalledOnce()
})

test('start after dispose forks nothing', () => {
  const { host, spawn } = setup()
  host.dispose()
  host.start()
  expect(spawn).not.toHaveBeenCalled()
})

test('listen and close resolve on done, with the request passed through', async () => {
  const { host, spawn, children } = setup()
  await host.listen(request(4000))
  await host.close(4000)
  expect(spawn).toHaveBeenCalledOnce()
  expect(children[0]!.requests).toEqual([
    { type: 'listen', id: 1, request: { ...request(4000), allowedOrigins: [] } },
    { type: 'close', id: 2, port: 4000 },
  ])
})

test('listens carry the allowed origins, also when restored after an exit (#596)', async () => {
  const { host, children } = setup()
  const origins = ['https://localhost:8080', 'https://127.0.0.1:8080']
  host.allowOrigins(origins)
  await host.listen(request(4000))
  // A request that names its own origins keeps them.
  await host.listen({ ...request(5000), allowedOrigins: ['http://localhost:5173'] })
  const sent = () =>
    children.at(-1)!.requests.flatMap((r) => (r.type === 'listen' ? [r.request] : []))
  expect(sent().map((r) => r.allowedOrigins)).toEqual([origins, ['http://localhost:5173']])
  children[0]!.crash()
  expect(sent().map((r) => [r.port, r.allowedOrigins])).toEqual([
    [4000, origins],
    [5000, ['http://localhost:5173']],
  ])
})

test('failed rejects with the message', async () => {
  const { host } = setup((r) => ({ type: 'failed', id: r.id, message: 'listen EADDRINUSE' }))
  await expect(host.listen(request(4000))).rejects.toThrow('listen EADDRINUSE')
  await expect(host.close(4000)).rejects.toThrow('listen EADDRINUSE')
})

test('one fork for many listens, answered by id even out of order', async () => {
  const pending: YdocHostRequest[] = []
  const { host, spawn, children } = setup((r) => void pending.push(r))
  const a = host.listen(request(4000))
  const b = host.listen(request(5000))
  await Promise.resolve()
  expect(spawn).toHaveBeenCalledOnce()
  children[0]!.emit('message', { type: 'done', id: pending[1]!.id })
  await b
  children[0]!.emit('message', { type: 'failed', id: pending[0]!.id, message: 'no' })
  await expect(a).rejects.toThrow('no')
})

test('a child that exits fails what it had not answered, and is forked again with its listeners', async () => {
  let answering = true
  const { host, spawn, children } = setup((r) => (answering ? done(r) : undefined))
  await host.listen(request(4000))
  await host.listen(request(5000))
  await host.close(5000)
  answering = false
  const lost = host.listen(request(6000))
  children[0]!.crash()
  await expect(lost).rejects.toThrow(/exited/)
  // The replacement is forked at once and gets back the listener still open (4000), not the closed
  // one (5000) nor the one that failed (6000).
  expect(spawn).toHaveBeenCalledTimes(2)
  expect(children[1]!.requests.map((r) => r.type === 'listen' && r.request.port)).toEqual([4000])
  answering = true
  await host.listen(request(7000))
  expect(spawn).toHaveBeenCalledTimes(2)
})

test('a child that keeps exiting is restarted with a growing delay, then left until a request', async () => {
  vi.useFakeTimers()
  try {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, spawn, children } = setup()
    await host.listen(request(4000))
    // The first exit restarts at once; each quick exit after that waits twice as long (1 s, 2 s,
    // 4 s, 8 s), and after five restarts nothing is forked until the next request.
    children[0]!.crash()
    expect(spawn).toHaveBeenCalledTimes(2)
    for (const [index, delay] of [1000, 2000, 4000, 8000].entries()) {
      children[index + 1]!.crash()
      expect(spawn).toHaveBeenCalledTimes(index + 2)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(spawn).toHaveBeenCalledTimes(index + 2)
      await vi.advanceTimersByTimeAsync(1)
      expect(spawn).toHaveBeenCalledTimes(index + 3)
    }
    children[5]!.crash()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(spawn).toHaveBeenCalledTimes(6)
    expect(error.mock.calls.some(([m]) => String(m).includes('not restarted'))).toBe(true)
    // A request forks again, with the listener still to restore.
    const restored = host.listen(request(5000))
    expect(spawn).toHaveBeenCalledTimes(7)
    await restored
    expect(children[6]!.requests.map((r) => r.type === 'listen' && r.request.port)).toEqual([
      4000, 5000,
    ])
    error.mockRestore()
  } finally {
    vi.useRealTimers()
  }
})

test('a child that ran for a while is restarted at once again', async () => {
  vi.useFakeTimers()
  try {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, spawn, children } = setup()
    await host.listen(request(4000))
    children[0]!.crash()
    children[1]!.crash()
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(61_000)
    children[2]!.crash()
    expect(spawn).toHaveBeenCalledTimes(4)
    error.mockRestore()
  } finally {
    vi.useRealTimers()
  }
})

test('an error event from the child is logged, and its exit restarts it', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { host, spawn, children } = setup()
  await host.listen(request(4000))
  expect(() => children[0]!.emit('error', 'FatalError', 'v8', 'report')).not.toThrow()
  expect(error).toHaveBeenCalled()
  expect(spawn).toHaveBeenCalledOnce()
  children[0]!.crash()
  expect(spawn).toHaveBeenCalledTimes(2)
  error.mockRestore()
})

test('a listen on a port another project holds is refused without reaching the child', async () => {
  const { host, children } = setup()
  await host.listen(request(4000))
  await expect(host.listen(request(4000))).rejects.toThrow(/EADDRINUSE/)
  expect(children[0]!.requests).toHaveLength(1)
  // Once closed, the port is free again.
  await host.close(4000)
  await host.listen(request(4000))
})

test('a close during a restore reaches the child after the restoring listen', async () => {
  const { host, children } = setup()
  await host.listen(request(4000))
  children[0]!.crash()
  await host.close(4000)
  expect(
    children[1]!.requests.map((r) => r.type + (r.type === 'listen' ? r.request.port : r.port)),
  ).toEqual(['listen4000', 'close4000'])
})

test('dispose kills the child and fails later requests', async () => {
  const { host, spawn, children } = setup()
  await host.listen(request(4000))
  host.dispose()
  expect(children[0]!.killed).toBe(true)
  await Promise.resolve()
  expect(spawn).toHaveBeenCalledOnce()
  await expect(host.listen(request(5000))).rejects.toThrow(/disposed/)
  expect(spawn).toHaveBeenCalledOnce()
})

test('a request during a backoff does not reset the restart limit', async () => {
  vi.useFakeTimers()
  try {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, spawn, children } = setup()
    await host.listen(request(4000))
    // Four quick restarts later the fifth exit is waiting out its 8 s delay.
    children[0]!.crash()
    for (const [index, delay] of [1000, 2000, 4000].entries()) {
      children[index + 1]!.crash()
      await vi.advanceTimersByTimeAsync(delay)
    }
    children[4]!.crash()
    expect(spawn).toHaveBeenCalledTimes(5)
    // A request forks at once, but this is still the same crash loop: its exit is the sixth.
    const pending = host.listen(request(5000))
    expect(spawn).toHaveBeenCalledTimes(6)
    await pending
    children[5]!.crash()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(spawn).toHaveBeenCalledTimes(6)
    expect(error.mock.calls.some(([m]) => String(m).includes('not restarted'))).toBe(true)
    error.mockRestore()
  } finally {
    vi.useRealTimers()
  }
})

test('a close during an in-flight listen wins: nothing is recorded as open', async () => {
  let release: (() => void) | undefined
  const { host, children } = setup((r) => {
    if (r.type === 'listen' && !release) {
      release = () => children[0]!.emit('message', done(r))
      return undefined
    }
    return done(r)
  })
  const listening = host.listen(request(4000))
  const closing = host.close(4000)
  release!()
  await listening
  await closing
  // The listener is not recorded as open: a restart does not restore it, and the port is free.
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  children[0]!.crash()
  error.mockRestore()
  expect(children).toHaveLength(1)
  await host.listen(request(4000))
})
