/** @file How long the runner waits between health checks while an engine starts. */
import { expect, test } from 'vitest'
import { loadHealthcheckDelay } from '../ensoRunner.js'

test('polls every 25 ms in the first second, then every 250 ms', () => {
  expect(loadHealthcheckDelay(0)).toBe(25)
  expect(loadHealthcheckDelay(999)).toBe(25)
  expect(loadHealthcheckDelay(1000)).toBe(250)
  expect(loadHealthcheckDelay(30_000)).toBe(250)
})
