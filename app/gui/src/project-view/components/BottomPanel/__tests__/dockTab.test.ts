import { afterEach, beforeEach, expect, test } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { DOCK_TAB_STORAGE_KEY, toggleDockTab, useDockTab, type DockTab } from '../dockTab'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

test('remembers the selected tab in local storage', async () => {
  const scope = effectScope()
  const first = scope.run(() => useDockTab())!
  expect(first.value).toBe('code')
  first.value = 'logs'
  await nextTick()
  expect(localStorage.getItem(DOCK_TAB_STORAGE_KEY)).toBe('logs')
  const second = scope.run(() => useDockTab())!
  expect(second.value).toBe('logs')
  scope.stop()
})

test('reads an unknown stored value as the Code tab', () => {
  localStorage.setItem(DOCK_TAB_STORAGE_KEY, 'terminal')
  const scope = effectScope()
  expect(scope.run(() => useDockTab())!.value).toBe('code')
  scope.stop()
})

test('toggleDockTab opens the dock on a tab, switches tabs, and closes when that tab shows', () => {
  const show = ref(false)
  const tab = ref<DockTab>('code')
  toggleDockTab(show, tab, 'logs')
  expect([show.value, tab.value]).toEqual([true, 'logs'])
  toggleDockTab(show, tab, 'logs')
  expect([show.value, tab.value]).toEqual([false, 'logs'])
  show.value = true
  tab.value = 'code'
  toggleDockTab(show, tab, 'logs')
  expect([show.value, tab.value]).toEqual([true, 'logs'])
})
