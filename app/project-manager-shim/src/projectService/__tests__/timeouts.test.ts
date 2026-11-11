import { describe, expect, test } from 'vitest'
import { ENGINE_TIMEOUTS, engineTimeouts, MAX_TIMEOUT_MS, timeoutFromEnv } from '../timeouts.js'

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

describe('engineTimeouts', () => {
  test('native and JVM columns', () => {
    expect(engineTimeouts('native', {})).toEqual({
      startupMs: 30_000,
      terminateMs: 10_000,
    })
    expect(engineTimeouts('jvm', {})).toEqual({
      startupMs: 120_000,
      terminateMs: 30_000,
    })
    expect(ENGINE_TIMEOUTS.jvm.startupMs).toBe(120_000)
  })
  test('the environment overrides both columns', () => {
    const env = {
      ENSO_ENGINE_STARTUP_TIMEOUT_MS: '180000',
      ENSO_ENGINE_TERMINATE_TIMEOUT_MS: '60000',
    }
    for (const mode of ['native', 'jvm'] as const) {
      expect(engineTimeouts(mode, env)).toMatchObject({ startupMs: 180_000, terminateMs: 60_000 })
    }
  })
  test('a bad override falls back to the column', () => {
    expect(engineTimeouts('jvm', { ENSO_ENGINE_STARTUP_TIMEOUT_MS: 'soon' }).startupMs).toBe(
      120_000,
    )
  })
})
