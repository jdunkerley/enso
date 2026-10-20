import { afterEach, beforeEach, expect, test } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  DOCK_TAB_STORAGE_KEY,
  dockTabActions,
  toggleDockTab,
  useDockTab,
  type DockTab,
} from '../dockTab'

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
  expect(toggleDockTab(show, tab, 'logs')).toBe('opened')
  expect([show.value, tab.value]).toEqual([true, 'logs'])
  expect(toggleDockTab(show, tab, 'logs')).toBe('closed')
  expect([show.value, tab.value]).toEqual([false, 'logs'])
  expect(toggleDockTab(show, tab, 'code')).toBe('opened')
  expect([show.value, tab.value]).toEqual([true, 'code'])
  expect(toggleDockTab(show, tab, 'logs')).toBe('switched')
  expect([show.value, tab.value]).toEqual([true, 'logs'])
  expect(toggleDockTab(show, tab, 'code')).toBe('switched')
  expect([show.value, tab.value]).toEqual([true, 'code'])
  expect(toggleDockTab(show, tab, 'code')).toBe('closed')
  expect([show.value, tab.value]).toEqual([false, 'code'])
})

test('dockTabActions: each shortcut is toggled only while its own tab shows', () => {
  const show = ref(false)
  const tab = ref<DockTab>('code')
  let requests = 0
  const actions = dockTabActions(show, tab, { request: () => void (requests += 1) })
  const toggled = () => [
    actions['graph.toggleCodeEditor'].toggled(),
    actions['graph.toggleLogs'].toggled(),
  ]
  expect(toggled()).toEqual([false, false])
  actions['graph.toggleLogs'].action()
  expect(toggled()).toEqual([false, true])
  actions['graph.toggleCodeEditor'].action()
  expect(toggled()).toEqual([true, false])
  // Switching from Logs to Code asks the code editor to take focus; nothing else does.
  expect(requests).toBe(1)
  actions['graph.toggleCodeEditor'].action()
  expect(toggled()).toEqual([false, false])
  expect(requests).toBe(1)
})
