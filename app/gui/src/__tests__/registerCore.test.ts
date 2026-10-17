/** @file The core's own contributions: the Versions tab, now that the cloud is not registered. */
import {
  resetRightPanelContributions,
  rightPanelTabContribution,
} from '$/providers/rightPanelContributions'
import { registerCore } from '$/registerCore'
import { afterEach, expect, test } from 'vitest'

afterEach(resetRightPanelContributions)

test('contributes the Versions tab, and neither Properties nor Schedule', async () => {
  registerCore()
  const load = rightPanelTabContribution('versions')
  expect(load).toBeTypeOf('function')
  const loaded = await load!()
  const component = 'default' in loaded ? loaded.default : loaded
  expect((component as { __name?: string }).__name).toBe('AssetVersions')
  expect(rightPanelTabContribution('settings')).toBeUndefined()
  expect(rightPanelTabContribution('executionsCalendar')).toBeUndefined()
})
