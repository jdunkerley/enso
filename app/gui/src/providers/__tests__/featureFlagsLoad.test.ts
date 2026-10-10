/**
 * @file The feature flags as the module loads them: an older saved version is migrated (and saved
 * migrated), and `window.overrideFeatureFlags` overrides the saved flags. A file of its own, because
 * the module defines non-configurable globals and so can be loaded only once per test file.
 */
import { expect, test } from 'vitest'

test('The saved flags are migrated, and overridden by `window.overrideFeatureFlags`', async () => {
  localStorage.setItem(
    'enso-feature-flags',
    JSON.stringify({
      state: {
        featureFlags: { enableLocalBackend: false, enableMultitabs: true, monoNodes: false },
      },
      version: 3,
    }),
  )
  window.overrideFeatureFlags = { enableLocalBackend: true }

  const { getFeatureFlag } = await import('../featureFlags')

  expect(getFeatureFlag('enableMultitabs')).toBe(true)
  expect(getFeatureFlag('enableLocalBackend')).toBe(true)
  const saved = JSON.parse(localStorage.getItem('enso-feature-flags') ?? 'null')
  expect(saved.version).toBe(4)
  expect(saved.state.featureFlags).toMatchObject({ enableMultitabs: true })
  expect(saved.state.featureFlags).not.toHaveProperty('monoNodes')
})
