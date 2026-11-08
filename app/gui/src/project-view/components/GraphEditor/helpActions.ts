import type { RightPanelData } from '$/providers/rightPanel'

/**
 * The graph editor's actions that open the component help: the toolbar's help toggle, and F1
 * (`graph.openDocumentation`), which always shows the Help tab of the right panel. The tab follows
 * the selected component, so F1 shows its documentation; with nothing selected it shows the tab's
 * hint.
 */
export function helpActionHandlers(
  rightPanel: Pick<RightPanelData, 'tab' | 'setTab' | 'toggleTab'>,
) {
  return {
    'graphEditor.showHelp': {
      action: () => rightPanel.toggleTab('help'),
      toggled: () => rightPanel.tab === 'help',
    },
    'graph.openDocumentation': {
      action: () => rightPanel.setTab('help'),
    },
  }
}
