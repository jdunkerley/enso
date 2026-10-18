/** @file The right panel's contributed tabs (#183): what the cloud fills, and what is left hidden. */
import {
  contributeRightPanelTab,
  resetRightPanelContributions,
  rightPanelTabContribution,
  type ContributedRightPanelTab,
} from '$/providers/rightPanelContributions'
import { afterEach, expect, expectTypeOf, test } from 'vitest'
import { computed, defineComponent } from 'vue'

afterEach(resetRightPanelContributions)

const Tab = defineComponent({ render: () => null })

test('a tab has no content until something contributes it', () => {
  expect(rightPanelTabContribution('versions')).toBeUndefined()
  const load = () => Promise.resolve({ default: Tab })
  contributeRightPanelTab('versions', load)
  expect(rightPanelTabContribution('versions')).toBe(load)
})

test('only Versions can be contributed', () => {
  expectTypeOf<ContributedRightPanelTab>().toEqualTypeOf<'versions'>()
})

test('a contribution is reactive, so that a tab hidden without one appears', () => {
  const hidden = computed(() => rightPanelTabContribution('versions') == null)
  expect(hidden.value).toBe(true)
  contributeRightPanelTab('versions', () => Promise.resolve(Tab))
  expect(hidden.value).toBe(false)
  resetRightPanelContributions()
  expect(hidden.value).toBe(true)
})
