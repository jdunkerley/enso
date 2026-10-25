/**
 * @file The HTTP test helper (`tools/http-test-helper`, our own server with the Enso Cloud mocks;
 * no public httpbin image will do), started as the retired build CLI started it
 * (the retired build CLI's `httpbin.rs`): `sbt "http-test-helper/run localhost <free port>"`, ready
 * once the port accepts a connection (at most 180 s), and stopped with everything it started
 * afterwards.
 */
import type { ChildProcess } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { killTree, spawnSbt } from '../lib/sbt.ts'

/** A free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, 'localhost', () => {
      const address = server.address()
      server.close(() => {
        if (address != null && typeof address === 'object') resolve(address.port)
        else reject(new Error('No port was assigned.'))
      })
    })
  })
}

/** Whether something accepts a connection on `localhost:<port>`. */
export function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: 'localhost', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Polls `ready` once a second until it is true, `gone` reports the server died, or `timeoutMs`
 * passes.
 */
export async function waitUntilReady(
  ready: () => Promise<boolean>,
  gone: () => boolean,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let waited = 0; ; waited += 1000) {
    if (gone()) throw new Error('The HTTP test helper exited before it accepted connections.')
    if (await ready()) return
    if (waited >= timeoutMs) {
      throw new Error(
        `The HTTP test helper did not accept connections within ${timeoutMs / 1000} s.`,
      )
    }
    await sleep(1000)
  }
}

/** A running HTTP test helper. */
export interface Httpbin {
  /** `ENSO_HTTP_TEST_HTTPBIN_URL`, with the trailing slash the retired build CLI's URL had. */
  readonly url: string
  readonly stop: () => void
}

/** Starts the HTTP test helper from the repository at `repoRoot` and waits until it is up. */
export async function startHttpbin(repoRoot: string, env: NodeJS.ProcessEnv): Promise<Httpbin> {
  const port = await freePort()
  const child: ChildProcess = spawnSbt(`http-test-helper/run localhost ${port}`, repoRoot, env)
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  const stop = () => killTree(child)
  try {
    await waitUntilReady(
      () => accepts(port),
      () => exited,
      180_000,
    )
  } catch (error) {
    stop()
    throw error
  }
  return { url: `http://localhost:${port}/`, stop }
}
