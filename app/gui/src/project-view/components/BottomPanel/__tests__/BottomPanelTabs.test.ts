import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { expect, test } from 'vitest'
import { nextTick } from 'vue'
import BottomPanelTabs from '../BottomPanelTabs.vue'

test('lists the tabs and selects one', async () => {
  const { wrapper } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: 'code', logsBadge: 0 },
  })
  const tabs = wrapper.findAll('[role="tab"]')
  expect(tabs.map((tab) => tab.text())).toEqual(['Code', 'Logs'])
  expect(tabs.map((tab) => tab.attributes('aria-selected'))).toEqual(['true', 'false'])
  await tabs[1]!.trigger('click')
  expect(wrapper.emitted('update:tab')).toEqual([['logs']])
})

test('shows the error badge only while the Logs tab is not selected', async () => {
  const { wrapper, setProps } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: 'code', logsBadge: 3 },
  })
  const badge = () => wrapper.find('[data-testid="logs-badge"]')
  expect(badge().text()).toBe('3')
  expect(badge().attributes('aria-label')).toBe('3 new errors')
  await setProps({ logsBadge: 120 })
  expect(badge().text()).toBe('99+')
  await setProps({ tab: 'logs' })
  expect(badge().exists()).toBe(false)
})

test('uses the singular for one new error', async () => {
  const { wrapper } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: 'code', logsBadge: 1 },
  })
  expect(wrapper.find('[data-testid="logs-badge"]').attributes('aria-label')).toBe('1 new error')
})

test('arrow keys move between the tabs, with a roving tabindex and linked panels', async () => {
  const { wrapper, setProps } = await mountWithProviders(BottomPanelTabs, {
    props: { tab: 'code', logsBadge: 0, idBase: 'x' },
  })
  const tabs = () => wrapper.findAll('[role="tab"]')
  expect(tabs().map((tab) => tab.attributes('tabindex'))).toEqual(['0', '-1'])
  expect(tabs().map((tab) => tab.attributes('aria-controls'))).toEqual([
    'x-panel-code',
    'x-panel-logs',
  ])
  await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
  expect(wrapper.emitted('update:tab')).toEqual([['logs']])
  await nextTick()
  expect(document.activeElement).toBe(tabs()[1]!.element)
  await setProps({ tab: 'logs' })
  expect(tabs().map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '0'])
  await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' })
  expect(wrapper.emitted('update:tab')?.[1]).toEqual(['code'])
  await nextTick()
  expect(document.activeElement).toBe(tabs()[0]!.element)
})
