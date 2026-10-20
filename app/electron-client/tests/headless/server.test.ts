/** @file Tests that the content server answers only the app's own window, on this machine. */
import * as fs from 'node:fs/promises'
import * as https from 'node:https'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, default: {} }))
vi.mock('ydoc-server', () => ({ configureAllDebugLogs: () => {} }))

const { Config, Server } = await import('../../src/server')

let server: InstanceType<typeof Server>
let dir: string
let port: number

/** A port free on every address. */
async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, resolve))
  const { port } = probe.address() as net.AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** The IPv6 loopback is missing on some machines. */
function hasIpv6Loopback(): boolean {
  return Object.values(os.networkInterfaces()).some((addresses) =>
    addresses?.some((address) => address.address === '::1'),
  )
}

/** An address of this machine that is not loopback, if it has one. */
function lanAddress(): string | undefined {
  return Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) => !address.internal && address.family === 'IPv4')?.address
}

interface Reply {
  readonly status: number
  readonly body: string
}

function send(
  options: { address?: string; method?: string; path: string; headers?: Record<string, string> },
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: options.address ?? '127.0.0.1',
        port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: { host: `localhost:${port}`, ...options.headers },
        rejectUnauthorized: false,
        timeout: 5_000,
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (text += chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }))
      },
    )
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.end(body)
  })
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-server-'))
  await fs.writeFile(path.join(dir, 'index.html'), '<p>app</p>')
  port = await freePort()
  const unused = {} as never
  server = new Server(new Config({ dir, port }), unused, unused, unused)
  await server.run()
})

afterAll(async () => {
  await server.close()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('listening', () => {
  test('answers on 127.0.0.1', async () => {
    expect(await send({ path: '/' })).toEqual({ status: 200, body: '<p>app</p>' })
  })

  test.runIf(hasIpv6Loopback())('answers on ::1', async () => {
    expect((await send({ address: '::1', path: '/' })).status).toBe(200)
  })

  test.runIf(lanAddress() != null)('cannot be reached on the LAN address', async () => {
    await expect(send({ address: lanAddress()!, path: '/' })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    })
  })
})

describe('requests', () => {
  const sameOrigin = () => ({
    origin: `https://localhost:${port}`,
    'sec-fetch-site': 'same-origin',
  })

  test('a same-origin API request is served', async () => {
    const reply = await send({ path: '/api/root-directory-path', headers: sameOrigin() })
    expect(reply.status).toBe(200)
  })

  test('a same-origin project-service POST is served', async () => {
    const reply = await send(
      { method: 'POST', path: '/api/project-service/secrets/status', headers: sameOrigin() },
      '{}',
    )
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('Local secrets are not available')
  })

  test('a request from a tool, with neither Origin nor Sec-Fetch-Site, is served', async () => {
    expect((await send({ path: '/api/root-directory-path' })).status).toBe(200)
  })

  test.each([
    ['a foreign Origin', { origin: 'https://evil.example' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site fetch', { 'sec-fetch-site': 'same-site' }],
  ])('a project-service POST with %s is refused', async (_, headers) => {
    const reply = await send(
      { method: 'POST', path: '/api/project-service/secrets/delete', headers },
      '{"name":"x"}',
    )
    expect(reply.status).toBe(403)
  })

  test('a cross-site command is refused', async () => {
    const reply = await send({
      method: 'POST',
      path: `/api/run-project-manager-command?cli-arguments=${encodeURIComponent('[]')}`,
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })
    expect(reply.status).toBe(403)
  })

  test('a request naming another host is refused, for static files too', async () => {
    const headers = { host: `evil.example:${port}` }
    expect((await send({ path: '/', headers })).status).toBe(403)
    expect((await send({ path: '/api/root-directory-path', headers })).status).toBe(403)
  })
})
