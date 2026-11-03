import { describe, expect, test } from 'vitest'
import { MAX_TIMEOUT_MS, timeoutFromEnv } from '../timeouts.js'

describe('timeoutFromEnv', () => {
  test('falls back when the variable is unset or empty', () => {
    expect(timeoutFromEnv(undefined, 30_000)).toBe(30_000)
    expect(timeoutFromEnv('', 30_000)).toBe(30_000)
    expect(timeoutFromEnv('  ', 30_000)).toBe(30_000)
  })
  test('falls back on a value that is not a finite positive number', () => {
    expect(timeoutFromEnv('abc', 10_000)).toBe(10_000)
    expect(timeoutFromEnv('NaN', 10_000)).toBe(10_000)
    expect(timeoutFromEnv('-5', 10_000)).toBe(10_000)
    expect(timeoutFromEnv('0', 10_000)).toBe(10_000)
    expect(timeoutFromEnv('Infinity', 10_000)).toBe(10_000)
    expect(timeoutFromEnv('-Infinity', 10_000)).toBe(10_000)
  })
  test('clamps a value setTimeout would turn into 1 ms', () => {
    expect(timeoutFromEnv(String(2 ** 31), 10_000)).toBe(MAX_TIMEOUT_MS)
    expect(timeoutFromEnv('1e20', 10_000)).toBe(MAX_TIMEOUT_MS)
    expect(timeoutFromEnv(String(MAX_TIMEOUT_MS), 10_000)).toBe(MAX_TIMEOUT_MS)
  })
  test('takes a normal value as it is', () => {
    expect(timeoutFromEnv('180000', 30_000)).toBe(180_000)
    expect(timeoutFromEnv(' 2500 ', 30_000)).toBe(2500)
  })
})
