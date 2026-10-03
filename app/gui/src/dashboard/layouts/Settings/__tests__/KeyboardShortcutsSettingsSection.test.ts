/**
 * @file The Keyboard shortcuts settings tab: listing, removing, adding (through the capture modal,
 * from the keyboard) and resetting shortcuts, on the window's dashboard bindings, saved as before.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { actionToTextId, BINDINGS } from '$/configurations/inputBindings'
import type * as DashboardInputBindingsModule from '$/providers/dashboardInputBindings'
import type { DashboardInputBindings } from '$/providers/dashboardInputBindings'
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
  const value: { saved: unknown; bindings: DashboardInputBindings | undefined } = {
    saved: undefined,
    bindings: undefined,
  }
  return value
})

vi.mock('$/providers/dashboardInputBindings', async (importOriginal) => {
  const original = await importOriginal<typeof DashboardInputBindingsModule>()
  return {
    ...original,
    getDashboardInputBindings: () => {
      state.bindings ??= original.createDashboardInputBindings({
        get: () => state.saved as never,
        set: (_key, value) => {
          state.saved = value
        },
      })
      return state.bindings
    },
  }
})

const { getText } = useText()

beforeEach(() => {
  state.saved = undefined
  state.bindings = undefined
  useModals().closeAll()
})

/** The tab, with the modal stack its dialogs open on. */
const Page = () => h('div', [h(KeyboardShortcutsSettingsSection), h(ModalHost)])

const findRow = (action: keyof typeof BINDINGS) =>
  [...document.querySelectorAll<HTMLElement>('tbody tr')].find(
    (tr) => tr.children[1]?.textContent.trim() === getText(actionToTextId(action)),
  )
const row = (action: keyof typeof BINDINGS) => required(findRow(action), `the ${action} row`)
const button = (container: ParentNode, name: string) =>
  required(container.querySelector<HTMLElement>(`button[aria-label="${name}"]`))
const shortcutsOf = (action: keyof typeof BINDINGS) =>
  [...required(row(action).children[2]).querySelectorAll('.inline-flex')].map((shortcut) =>
    shortcut.textContent.replace(/\s+/g, ' ').trim(),
  )

describe('KeyboardShortcutsSettingsSection', () => {
  test('lists every rebindable action, and none that is not', async () => {
    await mountWithProviders(Page)
    const rebindable = Object.entries(BINDINGS).filter(([, info]) => info.rebindable !== false)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(rebindable.length)
    expect(findRow('toggleEnsoDevtools')).toBeUndefined()
    expect(shortcutsOf('rename')).toHaveLength(BINDINGS.rename.bindings.length)
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
    await user.click(button(row('rename'), getText('addShortcut')))
    await flushPromises()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const dialog = required(document.querySelector<HTMLElement>('[role="dialog"]'))
    expect(dialog.textContent).toContain(
      getText('enterTheNewKeyboardShortcutFor', `'${getText(actionToTextId('rename'))}'`),
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

  test('will not add a shortcut that already exists', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('rename'), getText('addShortcut')))
    await flushPromises()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await user.keyboard('{Control>}c{/Control}')
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="dialog"]'))
    expect(dialog.textContent).toContain('This shortcut already exists.')
    const confirm = required(
      [...dialog.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === getText('confirm'),
      ),
    )
    expect(confirm.hasAttribute('disabled')).toBe(true)
  })

  test('Escape is captured as a key, and closes the modal when pressed again', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('rename'), getText('addShortcut')))
    await flushPromises()
    await new Promise((resolve) => requestAnimationFrame(resolve))
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

  test('resets every shortcut once confirmed', async () => {
    await mountWithProviders(Page)
    const user = userEvent.setup()
    await user.click(button(row('rename'), getText('removeShortcut')))
    await user.click(button(row('copy'), getText('removeShortcut')))
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
  })
})
