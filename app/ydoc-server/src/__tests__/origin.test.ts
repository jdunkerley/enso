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
