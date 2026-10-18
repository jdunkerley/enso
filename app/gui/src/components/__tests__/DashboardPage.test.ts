/**
 * @file The dashboard route's own behaviour, with the app container stubbed: the global shortcuts
 * in the command palette, Escape closing the modals, and the context menu closing them.
 */
import DashboardPage from '$/components/DashboardPage.vue'
import { useActionsStore } from '$/providers/actions'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('$/components/AppContainer', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('div', { 'data-testid': 'app-container' }) } }
})
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  const backends = mockBackends({ localBackend: null })
  return { useBackends: () => backends }
})
vi.mock('enso-common/src/utilities/detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('enso-common/src/utilities/detect')>()),
  isOnElectron: () => true,
}))

const { getText } = useText()

/** A modal for the stack: it renders nothing. */
const Blank = { render: () => null }

beforeEach(() => {
  useModals().closeAll()
})
afterEach(() => {
  useModals().closeAll()
})

/** The command palette's actions named `name`. */
function paletteActions(name: string) {
  return useActionsStore()
    .findActions('')
    .filter((action) => action.name === name)
}

describe('DashboardPage', () => {
  test('renders the app container', async () => {
    const { wrapper } = await mountWithProviders(DashboardPage)
    expect(wrapper.find('[data-testid="app-container"]').exists()).toBe(true)
  })

  test('puts the settings shortcuts in the command palette, and each goes to its tab', async () => {
    const { router } = await mountWithProviders(DashboardPage)
    await flushPromises()
    const [keyboardShortcuts] = paletteActions(getText('goToKeyboardShortcutsSettingsShortcut'))
    expect(keyboardShortcuts).toBeDefined()
    // There is no local backend.
    expect(paletteActions(getText('goToLocalSettingsShortcut'))).toHaveLength(0)
    keyboardShortcuts!.doAction()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(router.currentRoute.value.query['cloud-ide_SettingsTab']).toBe('"keyboard-shortcuts"')
  })

  test('leaves the palette once unmounted', async () => {
    const { unmount } = await mountWithProviders(DashboardPage)
    expect(paletteActions(getText('goToAccountSettingsShortcut'))).toHaveLength(1)
    unmount()
    expect(paletteActions(getText('goToAccountSettingsShortcut'))).toHaveLength(0)
  })

  test('Escape closes the open modals, and is left alone when there are none', async () => {
    await mountWithProviders(DashboardPage)
    const modals = useModals()
    modals.open(Blank, {})
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(handled)
    expect(modals.stack.value).toHaveLength(0)
    expect(handled.defaultPrevented).toBe(true)

    const unhandled = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(unhandled)
    expect(unhandled.defaultPrevented).toBe(false)
  })

  test('the context menu closes the open modals, without the browser menu', async () => {
    const { wrapper } = await mountWithProviders(DashboardPage)
    const modals = useModals()
    modals.open(Blank, {})
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    wrapper.find('[data-testid="app-container"]').element.dispatchEvent(event)
    expect(modals.stack.value).toHaveLength(0)
    expect(event.defaultPrevented).toBe(true)
  })

  test('does not close the modals already open as it mounts', async () => {
    const modals = useModals()
    modals.open(Blank, {})
    await mountWithProviders(DashboardPage)
    expect(modals.stack.value).toHaveLength(1)
  })
})
