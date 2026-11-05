/** @file The utility process's request handling (`src/ydocHost/serve.ts`): one port's requests run in order. */
import { expect, test } from 'vitest'

import type { YdocListenRequest } from 'project-manager-shim/projectService'
import type { YdocHostRequest } from '../../src/ydocHost/protocol'
import { ydocRequestHandler } from '../../src/ydocHost/serve'

const request = (port: number): YdocListenRequest => ({
  host: '127.0.0.1',
  port,
  languageServer: { host: '127.0.0.1', port: port + 1, token: 'a'.repeat(64) },
})

/** A host whose `listen` takes `listenMs`, recording when each call starts and ends. */
function slowHost(listenMs: number) {
  const events: string[] = []
  const bound = new Set<number>()
  return {
    events,
    bound,
    host: {
      listen: async (r: YdocListenRequest) => {
        events.push(`listen ${r.port} start`)
        await new Promise((resolve) => setTimeout(resolve, listenMs))
        bound.add(r.port)
        events.push(`listen ${r.port} end`)
      },
      close: async (port: number) => {
        events.push(`close ${port}`)
        bound.delete(port)
      },
    },
  }
}

test('a close that arrives while its port is still being listened on runs after it', async () => {
  const { host, events, bound } = slowHost(50)
  const handle = ydocRequestHandler(host)
  const answers = await Promise.all([
    handle({ type: 'listen', id: 1, request: request(4000) }),
    handle({ type: 'close', id: 2, port: 4000 }),
  ])
  expect(events).toEqual(['listen 4000 start', 'listen 4000 end', 'close 4000'])
  expect(bound.has(4000)).toBe(false)
  expect(answers).toEqual([
    { type: 'done', id: 1 },
    { type: 'done', id: 2 },
  ])
})

test('different ports do not wait for each other', async () => {
  const { host, events } = slowHost(50)
  const handle = ydocRequestHandler(host)
  await Promise.all([
    handle({ type: 'listen', id: 1, request: request(4000) }),
    handle({ type: 'listen', id: 2, request: request(5000) }),
  ])
  expect(events.slice(0, 2)).toEqual(['listen 4000 start', 'listen 5000 start'])
})

test('a failure is answered with its message and does not block the port', async () => {
  const handle = ydocRequestHandler({
    listen: () => Promise.reject(new Error('listen EADDRINUSE')),
    close: async () => {},
  })
  const messages: YdocHostRequest[] = [
    { type: 'listen', id: 1, request: request(4000) },
    { type: 'close', id: 2, port: 4000 },
  ]
  expect(await Promise.all(messages.map(handle))).toEqual([
    { type: 'failed', id: 1, message: 'listen EADDRINUSE' },
    { type: 'done', id: 2 },
  ])
})
