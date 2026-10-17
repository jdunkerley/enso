/**
 * @file The dashboard route's own behaviour, with the app container stubbed: the global shortcuts
 * in the command palette, Escape closing the modals, the context menu closing them, and the
 * dialog shown while the projects sync as the app exits.
 */
import DashboardPage from '$/components/DashboardPage.vue'
import { useActionsStore } from '$/providers/actions'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { Plan, type Backend } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'

const { closingOnAppExit, getOrganization } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  const { vi } = await import('vitest')
  return {
    closingOnAppExit: ref(false),
    getOrganization: vi.fn<Backend['getOrganization']>(),
  }
})

vi.mock('$/components/AppContainer', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('div', { 'data-testid': 'app-container' }) } }
})
vi.mock('$/providers/openedProjects', () => ({
  useOpenedProjects: () => ({ closingOnAppExit }),
}))
vi.mock('$/providers/auth', () => ({
  useAuth: () => ({
    session: {
      user: { plan: Plan.team, isOrganizationAdmin: true },
      isCloudDataUnavailable: false,
    },
  }),
}))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  const backends = mockBackends({ remoteBackend: { getOrganization }, localBackend: null })
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
  closingOnAppExit.value = false
  getOrganization.mockReset().mockResolvedValue({ subscription: {} } as never)
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
    const [members] = paletteActions(getText('goToMembersSettingsShortcut'))
    expect(members).toBeDefined()
    // The user is the organization's admin, and it has a subscription.
    expect(paletteActions(getText('goToBillingAndPlansSettingsShortcut'))).toHaveLength(1)
    // There is no local backend.
    expect(paletteActions(getText('goToLocalSettingsShortcut'))).toHaveLength(0)
    members!.doAction()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings')
    expect(router.currentRoute.value.query['cloud-ide_SettingsTab']).toBe('"members"')
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

  test('shows the syncing dialog alone while the projects sync as the app exits', async () => {
    await mountWithProviders(DashboardPage)
    const modals = useModals()
    modals.open(Blank, {})
    closingOnAppExit.value = true
    await nextTick()
    expect(modals.stack.value).toHaveLength(1)
    expect(modals.stack.value[0]!.component).not.toBe(Blank)
    closingOnAppExit.value = false
    await nextTick()
    expect(modals.stack.value).toHaveLength(0)
  })

  test('does not close the modals already open as it mounts', async () => {
    const modals = useModals()
    modals.open(Blank, {})
    await mountWithProviders(DashboardPage)
    expect(modals.stack.value).toHaveLength(1)
  })
})
