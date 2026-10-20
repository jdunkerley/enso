import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { acceptLocalRequest, checkLocalRequest, type LocalServerAddress } from '../localRequest.js'

const PORT = 8123
const SERVER: LocalServerAddress = { protocol: 'https:', port: PORT }
const API = '/api/project-service/secrets/delete'

function allowed(url: string, headers: http.IncomingHttpHeaders, server = SERVER) {
  return checkLocalRequest(url, headers, server).allowed
}

describe('Host', () => {
  test.each([`localhost:${PORT}`, `LOCALHOST:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`])(
    '%s is allowed',
    (host) => {
      expect(allowed('/index.html', { host })).toBe(true)
      expect(allowed(API, { host })).toBe(true)
    },
  )

  test.each([
    ['a missing Host', undefined],
    ['an empty Host', ''],
    ['a rebound domain', `evil.example:${PORT}`],
    ['a LAN address', `192.168.1.20:${PORT}`],
    ['a subdomain of localhost', `evil.localhost:${PORT}`],
    ['another port', `localhost:${PORT + 1}`],
    ['no port', 'localhost'],
    ['credentials', `evil.example@localhost:${PORT}`],
    ['a path', `localhost:${PORT}/x`],
    ['the wildcard address', `0.0.0.0:${PORT}`],
  ])('%s is refused, for static files too', (_, host) => {
    const headers = host == null ? {} : { host }
    expect(allowed('/index.html', headers)).toBe(false)
    expect(allowed(API, headers)).toBe(false)
  })

  test('the default port may be left out', () => {
    expect(allowed('/', { host: 'localhost' }, { protocol: 'https:', port: 443 })).toBe(true)
    expect(allowed('/', { host: 'localhost' }, { protocol: 'http:', port: 80 })).toBe(true)
  })

  test('extra host names are allowed, wildcards are not', () => {
    const server: LocalServerAddress = {
      protocol: 'http:',
      port: 5173,
      extraHostnames: ['Dev.Box', '0.0.0.0', '::', '::2'],
    }
    expect(allowed(API, { host: 'dev.box:5173' }, server)).toBe(true)
    expect(allowed(API, { host: '[::2]:5173' }, server)).toBe(true)
    expect(allowed(API, { host: '0.0.0.0:5173' }, server)).toBe(false)
    expect(allowed(API, { host: '[::]:5173' }, server)).toBe(false)
  })
})

describe('cross-site /api/ requests', () => {
  const host = `localhost:${PORT}`

  test('a request with neither Origin nor Sec-Fetch-Site is allowed', () => {
    expect(allowed(API, { host })).toBe(true)
  })

  test.each(['same-origin', 'none', 'SAME-ORIGIN'])('Sec-Fetch-Site: %s is allowed', (site) => {
    expect(allowed(API, { host, 'sec-fetch-site': site })).toBe(true)
  })

  test.each(['cross-site', 'same-site', 'bogus'])('Sec-Fetch-Site: %s is refused', (site) => {
    expect(allowed(API, { host, 'sec-fetch-site': site })).toBe(false)
    expect(allowed('/api/run-project-manager-command', { host, 'sec-fetch-site': site })).toBe(
      false,
    )
  })

  test.each([`https://localhost:${PORT}`, `https://127.0.0.1:${PORT}`, `https://[::1]:${PORT}`])(
    'Origin %s is allowed',
    (origin) => {
      expect(allowed(API, { host, origin, 'sec-fetch-site': 'same-origin' })).toBe(true)
    },
  )

  test.each([
    'https://evil.example',
    `https://evil.example:${PORT}`,
    `http://localhost:${PORT}`,
    `https://localhost:${PORT + 1}`,
    `https://evil.localhost:${PORT}`,
    'null',
    'not a url',
  ])('Origin %s is refused', (origin) => {
    expect(allowed(API, { host, origin })).toBe(false)
  })

  test('a cross-site request for a static file is allowed', () => {
    // A page may link to or embed the app; only the API changes state or reveals data.
    expect(
      allowed('/index.html', {
        host,
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
    ).toBe(true)
  })

  test('the export-archive hyperlink download is same-origin and allowed', () => {
    expect(
      allowed('/api/export-archive?assetIds=x', { host, 'sec-fetch-site': 'same-origin' }),
    ).toBe(true)
  })
})

describe('acceptLocalRequest', () => {
  let server: http.Server | undefined

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
    server = undefined
  })

  async function serve(): Promise<number> {
    server = http.createServer((request, response) => {
      const port = (request.socket.address() as AddressInfo).port
      if (acceptLocalRequest(request, response, { protocol: 'http:', port }, { 'X-Test': 'yes' })) {
        response.writeHead(200).end('ok')
      }
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }

  function send(port: number, headers: http.OutgoingHttpHeaders) {
    return new Promise<{ status: number; body: string; test: string | undefined }>(
      (resolve, reject) => {
        const request = http.request(
          { host: '127.0.0.1', port, path: API, method: 'POST', headers },
          (response) => {
            let body = ''
            response.on('data', (chunk) => (body += chunk))
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body,
                test: response.headers['x-test'] as string | undefined,
              }),
            )
          },
        )
        request.on('error', reject)
        request.end('{}')
      },
    )
  }

  test('serves an allowed request and refuses the others with 403', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const port = await serve()
    expect(await send(port, { host: `localhost:${port}` })).toMatchObject({
      status: 200,
      body: 'ok',
    })
    const refused = await send(port, {
      host: `localhost:${port}`,
      origin: 'https://evil.example',
    })
    expect(refused.status).toBe(403)
    expect(refused.body).toContain('another origin')
    expect(refused.test).toBe('yes')
    expect((await send(port, { host: `evil.example:${port}` })).status).toBe(403)
  })
})
