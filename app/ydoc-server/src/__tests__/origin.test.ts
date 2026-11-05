import { expect, test } from 'vitest'
import { originAllowed } from '../origin'

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
