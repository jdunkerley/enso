/**
 * @file The graph editor's rebindable actions in the command palette (#170): there while the graph
 * editor is active, enabled, named and grouped as in the settings, with the current shortcuts.
 */
import { useActionsStore } from '$/providers/actions'
import { getInputBindingsStore } from '$/providers/inputBindings'
import { useText } from '$/providers/text'
import { useGraphPaletteActions } from '@/composables/graphPaletteActions'
import type { Action } from '@/providers/action'
import { appWithSetup } from '@/util/testing'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const { getText } = useText()

afterEach(() => {
  getInputBindingsStore().resetAll()
})

/** The palette's entries for the graph's actions. */
function graphEntries() {
  const graphCategories = new Set([
    getText('graphEditorBindingCategory'),
    getText('graphComponentsBindingCategory'),
  ])
  return useActionsStore()
    .findActions('')
    .filter((action) => graphCategories.has(action.category))
}

describe('useGraphPaletteActions', () => {
  test('lists the enabled rebindable actions while active, with their current shortcuts', async () => {
    const undo = vi.fn()
    const canRedo = ref(false)
    const handlers: Partial<Record<string, Action>> = {
      'graph.undo': { action: undo },
      'graph.redo': { action: vi.fn(), enabled: canRedo },
      'graph.deselectAll': { action: vi.fn() },
    }
    const active = ref(true)
    const [, app] = appWithSetup(() => useGraphPaletteActions(handlers, active))

    const undoEntry = () =>
      graphEntries().find((entry) => entry.name === getText('graphUndoShortcut'))
    expect(undoEntry()?.category).toBe(getText('graphEditorBindingCategory'))
    expect(undoEntry()?.shortcuts).toEqual(['Mod+Z'])
    expect(undoEntry()?.icon).toBe('undo')
    // Disabled, or not rebindable: not listed.
    expect(graphEntries().map((entry) => entry.name)).toEqual([getText('graphUndoShortcut')])
    canRedo.value = true
    expect(graphEntries().map((entry) => entry.name)).toContain(getText('graphRedoShortcut'))

    getInputBindingsStore().add('graph.undo', 'Mod+U')
    expect(undoEntry()?.shortcuts).toEqual(['Mod+Z', 'Mod+U'])
    undoEntry()?.doAction()
    expect(undo).toHaveBeenCalledOnce()

    active.value = false
    await nextTick()
    expect(graphEntries()).toEqual([])
    active.value = true
    await nextTick()
    expect(undoEntry()).toBeDefined()
    app.unmount()
    expect(graphEntries()).toEqual([])
  })
})
