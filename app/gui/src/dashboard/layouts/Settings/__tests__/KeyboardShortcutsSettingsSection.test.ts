/**
 * @file The Keyboard shortcuts settings tab: listing, removing, adding (through the capture modal,
 * from the keyboard) and resetting shortcuts, on the window's bindings, saved as before; and, since
 * #170, the graph editor's shortcuts beside the dashboard's, grouped by category, with conflicts
 * checked by scope.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { GRAPH_BINDINGS } from '$/configurations/graphInputBindings'
import { BINDINGS } from '$/configurations/inputBindings'
import { defaultShortcuts, type ShortcutId } from '$/configurations/keyboardShortcuts'
import type * as InputBindingsModule from '$/providers/inputBindings'
import type { InputBindingsStore } from '$/providers/inputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import KeyboardShortcutsSettingsSection from '../KeyboardShortcutsSettingsSection.vue'
import { required } from './dom'

/** What the bindings saved, and the bindings themselves: new for each test. */
const state = vi.hoisted(() => {
  const value: { saved: unknown; store: InputBindingsStore | undefined } = {
    saved: undefined,
    store: undefined,
  }
  return value
})

vi.mock('$/providers/inputBindings', async (importOriginal) => {
  const original = await importOriginal<typeof InputBindingsModule>()
  return {
    ...original,
    getInputBindingsStore: () => {
      state.store ??= original.createInputBindingsStore({
        get: () => state.saved as never,
        set: (_key, value) => {
          state.saved = value
        },
      })
      return state.store
    },
  }
})

const { getText } = useText()

beforeEach(() => {
  state.saved = undefined
  state.store = undefined
  useModals().closeAll()
})

/** The tab, with the modal stack its dialogs open on. */
const Page = () => h('div', [h(KeyboardShortcutsSettingsSection), h(ModalHost)])

const findRow = (action: ShortcutId) =>
  document.querySelector<HTMLElement>(`tbody tr[data-shortcut-id="${action}"]`) ?? undefined
const row = (action: ShortcutId) => required(findRow(action), `the ${action} row`)
const button = (container: ParentNode, name: string) =>
  required(container.querySelector<HTMLElement>(`button[aria-label="${name}"]`))
const shortcutsOf = (action: ShortcutId) =>
  [...required(row(action).children[2]).querySelectorAll('.inline-flex')].map((shortcut) =>
    shortcut.textContent.replace(/\s+/g, ' ').trim(),
  )
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const confirmButton = (dialog: HTMLElement) =>
  required(
    [...dialog.querySelectorAll('button')].find(
      (element) => element.textContent.trim() === getText('confirm'),
    ),
  )

/** Open the capture modal of `action`'s row, ready for keys. */
async function openCapture(user: ReturnType<typeof userEvent.setup>, action: ShortcutId) {
  await user.click(button(row(action), getText('addShortcut')))
  await flushPromises()
  await nextFrame()
  return required(document.querySelector<HTMLElement>('[role="dialog"]'))
}

describe('KeyboardShortcutsSettingsSection', () => {
  test('lists every rebindable action, and none that is not', async () => {
    await mountWithProviders(Page)
    const rebindable = defaultShortcuts().filter((shortcut) => shortcut.rebindable)
    expect(document.querySelectorAll('tbody tr[data-shortcut-id]')).toHaveLength(rebindable.length)
    expect(findRow('toggleEnsoDevtools')).toBeUndefined()
    expect(shortcutsOf('rename')).toHaveLength(BINDINGS.rename.bindings.length)
  })

  test("lists the graph editor's actions in their categories, after the dashboard's", async () => {
    await mountWithProviders(Page)
    const headings = [...document.querySelectorAll('tbody th')].map((th) => th.textContent.trim())
    expect(headings.slice(-2)).toEqual([
      getText('graphEditorBindingCategory'),
      getText('graphComponentsBindingCategory'),
    ])
    expect(row('graph.undo').closest('tbody')?.dataset.category).toBe('graphEditor')
    expect(row('components.copy').closest('tbody')?.dataset.category).toBe('graphComponents')
    expect(row('graph.undo').children[1]?.textContent.trim()).toBe(getText('graphUndoShortcut'))
    expect(shortcutsOf('graph.undo')).toHaveLength(1)
    // Escape stays the graph's cancel, and Delete on a connection follows Delete on components.
    expect(findRow('graph.deselectAll')).toBeUndefined()
    expect(findRow('graph.deleteSelectedEdge')).toBeUndefined()
  })

  test('removes a shortcut, and saves the change', async () => {
    await mountWithProviders(Page)
    await userEvent.setup().click(button(row('rename'), getText('removeShortcut')))
    await flushPromises()
    expect(shortcutsOf('rename')).toEqual([])
    expect(state.saved).toMatchObject({ rename: [] })
  })

  test('adds a shortcut typed into the capture modal', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    const dialog = await openCapture(user, 'rename')
    expect(dialog.textContent).toContain(
      getText('enterTheNewKeyboardShortcutFor', `'${getText('renameShortcut')}'`),
    )
    expect(dialog.textContent).toContain(getText('noShortcutEntered'))
    // The keys go to the form at once, without a click into the dialog first.
    expect(document.activeElement?.tagName).toBe('FORM')
    await user.keyboard('{Control>}{Shift>}k{/Shift}{/Control}')
    await flushPromises()
    expect(dialog.textContent).not.toContain(getText('noShortcutEntered'))
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(state.saved).toMatchObject({ rename: [...BINDINGS.rename.bindings, 'Mod+Shift+K'] })
  })

  test('adds a shortcut to a graph action, saving only that graph action', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('graph.toggleCodeEditor'), getText('removeShortcut')))
    await openCapture(user, 'graph.toggleCodeEditor')
    await user.keyboard('{Control>}{Shift>}u{/Shift}{/Control}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(shortcutsOf('graph.toggleCodeEditor')).toHaveLength(1)
    expect(state.store?.graph.metadata['graph.toggleCodeEditor'].bindings).toEqual(['Mod+Shift+U'])
    const saved = state.saved as Record<string, readonly string[]>
    expect(saved['graph.toggleCodeEditor']).toEqual(['Mod+Shift+U'])
    expect(saved['$version']).toEqual(['2'])
    expect(Object.keys(saved).filter((key) => key in GRAPH_BINDINGS)).toEqual([
      'graph.toggleCodeEditor',
    ])
  })

  test('will not add a shortcut the action already has', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    const dialog = await openCapture(user, 'rename')
    await user.keyboard('{Control>}r{/Control}')
    await flushPromises()
    expect(dialog.textContent).toContain(getText('shortcutAlreadyExists'))
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(true)
  })

  test('will not add a shortcut that another action has in the same scope, and names it', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    const dialog = await openCapture(user, 'rename')
    await user.keyboard('{Control>}c{/Control}')
    await flushPromises()
    expect(dialog.textContent).toContain(
      getText('shortcutAlreadyUsedBy', `'${getText('copyShortcut')}'`),
    )
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(true)
  })

  test("a graph shortcut may have a drive shortcut's key, but not an app-wide one", async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    // Rename (`Mod+R`) is the drive's: never active with the graph's.
    let dialog = await openCapture(user, 'graph.fitAll')
    await user.keyboard('{Control>}r{/Control}')
    await flushPromises()
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(false)
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(state.store?.graph.metadata['graph.fitAll'].bindings).toContain('Mod+R')
    // Settings (`Mod+,`) works everywhere, over the graph too.
    dialog = await openCapture(user, 'graph.fitAll')
    await user.keyboard('{Control>},{/Control}')
    await flushPromises()
    expect(dialog.textContent).toContain(
      getText('shortcutAlreadyUsedBy', `'${getText('settingsShortcut')}'`),
    )
    expect(confirmButton(dialog).hasAttribute('disabled')).toBe(true)
  })

  test('a graph shortcut captures a digit key by its position', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await openCapture(user, 'graph.fitAll')
    // `Shift+2` types `@`, but the graph editor matches digits by the key's position.
    await user.keyboard('{Control>}{Shift>}@{/Shift}{/Control}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(state.store?.graph.metadata['graph.fitAll'].bindings).toContain('Mod+Shift+2')
    // The dashboard's handlers match `event.key`, so its shortcuts keep the character.
    await openCapture(user, 'rename')
    await user.keyboard('{Control>}{Shift>}@{/Shift}{/Control}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(state.store?.dashboard.metadata.rename.bindings).toContain('Mod+Shift+@')
  })

  test('shows a conflict that a reset brings back', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('graph.undo'), getText('removeShortcut')))
    await openCapture(user, 'graph.fitAll')
    await user.keyboard('{Control>}z{/Control}')
    await user.keyboard('{Enter}')
    await flushPromises()
    const undoConflict = getText('shortcutConflictsWith', `'${getText('graphUndoShortcut')}'`)
    expect(row('graph.fitAll').textContent).not.toContain(undoConflict)
    await user.click(button(row('graph.undo'), getText('resetShortcut')))
    await flushPromises()
    expect(row('graph.fitAll').textContent).toContain(undoConflict)
    expect(row('graph.undo').textContent).toContain(
      getText('shortcutConflictsWith', `'${getText('graphFitAllShortcut')}'`),
    )
  })

  test('Escape is captured as a key, and closes the modal when pressed again', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await openCapture(user, 'rename')
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Escape')
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(state.saved).toBeUndefined()
  })

  test("resets an action's shortcuts", async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('rename'), getText('removeShortcut')))
    await user.click(button(row('rename'), getText('resetShortcut')))
    await flushPromises()
    expect(shortcutsOf('rename')).toHaveLength(BINDINGS.rename.bindings.length)
    expect(state.saved).toMatchObject({ rename: BINDINGS.rename.bindings })
  })

  test("resets every shortcut once confirmed, the graph editor's too", async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('rename'), getText('removeShortcut')))
    await user.click(button(row('copy'), getText('removeShortcut')))
    await user.click(button(row('graph.undo'), getText('removeShortcut')))
    const resetAll = required(
      [...document.querySelectorAll<HTMLElement>('button')].find(
        (element) => element.textContent.trim() === getText('resetAll'),
      ),
    )
    await user.click(resetAll)
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="alertdialog"]'))
    expect(dialog.textContent).toContain(getText('resetAllKeyboardShortcuts'))
    await user.click(
      required(dialog.querySelector<HTMLElement>('[data-testid="alert-dialog-confirm"]')),
    )
    await flushPromises()
    expect(shortcutsOf('rename')).toHaveLength(BINDINGS.rename.bindings.length)
    expect(shortcutsOf('copy')).toHaveLength(BINDINGS.copy.bindings.length)
    expect(shortcutsOf('graph.undo')).toHaveLength(1)
    expect(Object.keys(state.saved as object)).not.toContain('graph.undo')
  })
})
