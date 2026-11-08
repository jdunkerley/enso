import type { RightPanelTabId } from '$/providers/rightPanel'
import { describe, expect, test } from 'vitest'
import { reactive } from 'vue'
import { helpActionHandlers } from '../helpActions'

/** A right panel which records the tab, as the real one does. */
function fakeRightPanel(initial: RightPanelTabId | undefined) {
  const panel = reactive({
    tab: initial,
    setTab: (tab: RightPanelTabId | undefined) => (panel.tab = tab),
    toggleTab: (tab?: RightPanelTabId) => (panel.tab = panel.tab === tab ? undefined : tab),
  })
  return panel
}

describe('F1 (graph.openDocumentation)', () => {
  test.each<RightPanelTabId | undefined>([undefined, 'documentation', 'sessions'])(
    'opens the Help tab when the panel shows %s',
    (initial) => {
      const panel = fakeRightPanel(initial)
      helpActionHandlers(panel)['graph.openDocumentation'].action()
      expect(panel.tab).toBe('help')
    },
  )

  test('keeps the Help tab open when it already shows', () => {
    const panel = fakeRightPanel('help')
    const handlers = helpActionHandlers(panel)
    handlers['graph.openDocumentation'].action()
    handlers['graph.openDocumentation'].action()
    expect(panel.tab).toBe('help')
  })
})

describe('graphEditor.showHelp', () => {
  test('toggles the Help tab', () => {
    const panel = fakeRightPanel(undefined)
    const handlers = helpActionHandlers(panel)['graphEditor.showHelp']
    handlers.action()
    expect(panel.tab).toBe('help')
    expect(handlers.toggled()).toBe(true)
    handlers.action()
    expect(panel.tab).toBeUndefined()
    expect(handlers.toggled()).toBe(false)
  })
})
