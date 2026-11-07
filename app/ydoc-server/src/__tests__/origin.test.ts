import { expect, test } from 'vitest'
import { originAllowed, parseOrigin } from '../origin'

const ALLOWED = ['https://localhost:8080', 'http://127.0.0.1:5173/']

test.each([
  [undefined, true],
  ['https://localhost:8080', true],
  ['HTTPS://LOCALHOST:8080', true],
  ['http://127.0.0.1:5173', true],
  ['https://localhost:8081', false],
  ['http://localhost:8080', false],
  ['https://localhost', false],
  ['https://evil.example', false],
  ['null', false],
  ['', false],
  ['not a url', false],
])('Origin %s allowed: %s', (origin, allowed) => {
  expect(originAllowed(origin, ALLOWED)).toBe(allowed)
})

test('no allowed origins refuses every Origin, but not its absence', () => {
  expect(originAllowed('https://localhost:8080', [])).toBe(false)
  expect(originAllowed(undefined, [])).toBe(true)
})

// The engine-hosted listener has no `URL` (GraalJS) and parses origins by hand (#614).
test.each([
  'https://localhost:8080',
  'HTTPS://LOCALHOST:8080',
  'http://127.0.0.1:5173/',
  'http://127.0.0.1:5173/base/',
  'https://localhost:443',
  'http://localhost:80',
  'https://localhost:08080',
  'https://[::1]:8080',
  'https://[::1]',
  'https://evil.example',
  'https://localhost:65536',
  'https://user@localhost:8080',
  'null',
  '',
  'not a url',
  'localhost:8080',
  // The adversarial cases of the #628 review (`parseOrigin-adversarial.mjs`).
  'https://localhost:5000@evil.example',
  'https://localhost@evil.example',
  'http://allowed@evil',
  'https://user:pw@localhost:5000',
  'https://evil.example#@localhost:5000',
  'https://evil.example/@localhost:5000',
  'https://evil.example?x=https://localhost:5000',
  'https://localhost:5000.evil.example',
  'https://localhost.:5000',
  'https://LOCALHOST:5000',
  'HTTPS://localhost:5000',
  'https://localhost:443',
  'https://localhost',
  'https://localhost:0',
  'https://localhost:00000',
  'https://localhost:05000',
  'https://localhost:',
  'https://localhost:65535',
  'https://localhost:65536',
  'https://localhost:99999',
  'https://localhost:5000:5000',
  'http://[::1]:5173',
  'http://[0:0:0:0:0:0:0:1]:5173',
  'http://[::ffff:127.0.0.1]:5173',
  'http://[::1%25eth0]:5173',
  'http://[::1]',
  'http://[]:5173',
  'http://0x7f.1:5000',
  'https://2130706433:5000',
  'https://127.1:5000',
  'https://127.0.0.1.:5000',
  'https://127.0.0.01:5000',
  'https://256.0.0.1:5000',
  'NULL',
  ' ',
  'file://',
  'file:///C:/x',
  'file://localhost:5000/x',
  'chrome-extension://abcdefghijklmnop',
  'chrome-extension://localhost:5000',
  'moz-extension://localhost:5000',
  'ws://localhost:5000',
  'wss://localhost:5000',
  'ws://localhost:80',
  'blob:https://localhost:5000/uuid',
  'data:text/html,x',
  'https://xn--lcalhost-x6a:5000',
  'https://xn--nxasmq6b:5000',
  'https://l\u043ecalhost:5000',
  'https://\uff4cocalhost:5000',
  ' https://localhost:5000',
  'https://localhost:5000 ',
  '\thttps://localhost:5000',
  'https://local\thost:5000',
  'https://localhost:5000\n',
  'https://localhost:5000\r\nX: y',
  'https://localhost:5000\0',
  'https://local\0host:5000',
  'https://localhost\\@evil.example:5000',
  'https:\\localhost:5000',
  'https:/localhost:5000',
  'https:localhost:5000',
  'https://localhost:5000/',
  'https://localhost:5000/a?b#c',
  'https://localhost:+5000',
  'https://localhost:5e3',
  'https://localhost:-1',
  'https://localhost:5000%2F@evil',
  'https://localhost%2Eevil:5000',
  '*',
  'https://*',
  'https://localhost:\u0665\u0660\u0660\u0660',
  'https://a..b:5000',
])('parseOrigin(%s) is what URL makes of it, or refused', (value) => {
  const parsed = parseOrigin(value)
  let expected: string | undefined
  try {
    const origin = new URL(value).origin
    expected = origin === 'null' ? undefined : origin
  } catch {
    expected = undefined
  }
  // Refusing what URL would accept is safe (fails closed); answering differently is not.
  if (parsed != null) expect(parsed).toBe(expected)
  if (expected == null) expect(parsed).toBeUndefined()
})

test('without URL, origins are still compared as origins', () => {
  const url = globalThis.URL
  try {
    // @ts-expect-error -- GraalJS has no URL.
    delete globalThis.URL
    expect(originAllowed('HTTPS://LOCALHOST:8080', ALLOWED)).toBe(true)
    expect(originAllowed('http://127.0.0.1:5173', ALLOWED)).toBe(true)
    expect(originAllowed('https://localhost:8081', ALLOWED)).toBe(false)
    expect(originAllowed('null', ALLOWED)).toBe(false)
    expect(originAllowed(undefined, ALLOWED)).toBe(true)
  } finally {
    globalThis.URL = url
  }
})
