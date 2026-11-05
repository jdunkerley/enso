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
    { type: 'listen', id: 1, request: request(4000) },
    { type: 'close', id: 2, port: 4000 },
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

test('a child that keeps exiting is restarted once, then only on the next request', async () => {
  const { host, spawn, children } = setup()
  await host.listen(request(4000))
  children[0]!.crash()
  expect(spawn).toHaveBeenCalledTimes(2)
  children[1]!.crash()
  expect(spawn).toHaveBeenCalledTimes(2)
  await host.listen(request(5000))
  expect(spawn).toHaveBeenCalledTimes(3)
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
