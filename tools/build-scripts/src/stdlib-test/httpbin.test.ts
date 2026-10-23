/** @file Waiting for the HTTP test helper. */
import { createServer } from 'node:net'
import { expect, test } from 'vitest'
import { accepts, freePort, waitUntilReady } from './httpbin.ts'

const instant = async () => {}

test('ready on the third poll', async () => {
  let polls = 0
  await waitUntilReady(
    async () => ++polls === 3,
    () => false,
    180_000,
    instant,
  )
  expect(polls).toBe(3)
})

test('a helper that exits early fails at once', async () => {
  await expect(
    waitUntilReady(
      async () => false,
      () => true,
      180_000,
      instant,
    ),
  ).rejects.toThrow('exited before it accepted connections')
})

test('a helper that never listens times out', async () => {
  await expect(
    waitUntilReady(
      async () => false,
      () => false,
      3000,
      instant,
    ),
  ).rejects.toThrow('within 3 s')
})

test('accepts sees a listening port, and a free port is free', async () => {
  const port = await freePort()
  expect(await accepts(port)).toBe(false)
  const server = createServer().listen(port, 'localhost')
  await new Promise((resolve) => server.once('listening', resolve))
  expect(await accepts(port)).toBe(true)
  server.close()
})
