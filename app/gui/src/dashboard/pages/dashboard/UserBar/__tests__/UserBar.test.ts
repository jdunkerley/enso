/**
 * @file The Vue user bar (#83): the user menu (a dialog of buttons), its entries as global actions,
 * the notification tray and the offline notice; no cloud-only buttons, whatever the plan.
 */
import { useAboutModal } from '$/components/AboutModal/aboutModal'
import { useActionsStore } from '$/providers/actions'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { onlineManager } from '@tanstack/vue-query'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  EmailAddress,
  OrganizationId,
  Plan,
  PLANS,
  UserId,
  type User,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, shallowRef } from 'vue'
import UserBar from '../UserBar.vue'

const auth = reactive<{ session: { user: User; isAuthDisabled?: boolean } | null }>({
  session: null,
})
vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))

const localBackend = shallowRef<object | null>({})
vi.mock('$/providers/backends', async () => {
  const { mockBackends: mock } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () => {
      const backends = mock({ remoteBackend: {} })
      return reactive({
        get localBackend() {
          return localBackend.value
        },
        remoteBackend: backends.remoteBackend,
      })
    },
  }
})

const { getText } = useText()

// The overlays teleport into the portal root that `index.html` provides.
let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => {
  portalRoot.remove()
})

/**
 * The value, which the test requires to be there.
 * @throws {Error} When it is not.
 */
function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a value.')
  return value
}

/** An element's text, trimmed. */
const textOf = (element: Element | null | undefined) => element?.textContent.trim()

function makeUser(overrides: Partial<User> = {}): User {
  return {
    userId: UserId('user-1'),
    organizationId: OrganizationId('organization-1'),
    name: 'Ada Lovelace',
    email: EmailAddress('ada@example.com'),
    isEnabled: true,
    isOrganizationAdmin: false,
    userGroups: null,
    plan: Plan.solo,
    groups: [],
    isEnsoTeamMember: false,
    ...overrides,
  } as User
}

async function mountUserBar() {
  const goToSettingsPage = vi.fn()
  const mounted = await mountWithProviders(UserBar, { props: { goToSettingsPage } })
  return { ...mounted, goToSettingsPage }
}

const userMenuButton = () =>
  must(document.querySelector<HTMLElement>(`button[aria-label="${getText('userMenuLabel')}"]`))
const userMenu = () => document.querySelector<HTMLElement>('[data-testid="user-menu"]')
const entryNames = () =>
  [...(userMenu()?.querySelectorAll('button') ?? [])].map((button) =>
    textOf(button.querySelector('span')),
  )
const entry = (name: string) =>
  must(
    [...(userMenu()?.querySelectorAll('button') ?? [])].find(
      (button) => textOf(button.querySelector('span')) === name,
    ),
  )

beforeEach(() => {
  auth.session = { user: makeUser() }
  localBackend.value = {}
})

afterEach(() => {
  useAboutModal().isOpen.value = false
  onlineManager.setOnline(true)
  useToasts().dismiss()
})

describe('UserBar', () => {
  test('nothing without a user', async () => {
    auth.session = null
    const { wrapper } = await mountUserBar()
    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  test('the user menu: a "User Settings" dialog of buttons, focused as it opens', async () => {
    await mountUserBar()
    const user = userEvent.setup()
    userMenuButton().focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    const menu = must(userMenu())
    expect(menu.getAttribute('role')).toBe('dialog')
    expect(menu.getAttribute('aria-label')).toBe(getText('userMenuLabel'))
    // The dialog itself takes the focus, then Tab goes to the entries.
    expect(document.activeElement).toBe(menu)
    expect(menu.textContent).toContain('Ada Lovelace')
    expect(menu.textContent).toContain(getText(Plan.solo))
    expect(entryNames()).toEqual([getText('settingsShortcut'), getText('aboutThisAppShortcut')])
    await user.tab()
    expect(document.activeElement).toBe(entry(getText('settingsShortcut')))
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(userMenu()).toBeNull()
    expect(document.activeElement).toBe(userMenuButton())
  })

  test('"Download app" without a local backend', async () => {
    localBackend.value = null
    auth.session = { user: makeUser({ plan: Plan.team }) }
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([
      getText('downloadAppShortcut'),
      getText('settingsShortcut'),
      getText('aboutThisAppShortcut'),
    ])
  })

  test('local mode: "Working locally", no "Upgrade Plan" or "Logout", in menu or actions', async () => {
    // The offline stand-in session: a synthetic user on the free plan, with authentication off.
    auth.session = { user: makeUser({ plan: Plan.free }), isAuthDisabled: true }
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([getText('settingsShortcut'), getText('aboutThisAppShortcut')])
    expect(must(userMenu()).textContent).not.toContain(getText(Plan.free))
    expect(must(userMenu()).textContent).toContain('Working locally')
    const names = useActionsStore()
      .findActions('')
      .map((action) => action.name)
    expect(names).not.toContain(getText('upgradePlanShortcut'))
    expect(names).not.toContain(getText('signOutShortcut'))
  })

  test('local mode: no "Upgrade" for an organization admin on the free plan', async () => {
    auth.session = {
      user: makeUser({ isOrganizationAdmin: true, plan: Plan.free }),
      isAuthDisabled: true,
    }
    await mountUserBar()
    expect([...document.querySelectorAll('a')].map(textOf)).not.toContain(getText('upgrade'))
  })

  test('no "Invite", "Upgrade" or "Upgrade Plan", whatever the plan', async () => {
    const user = userEvent.setup()
    for (const plan of PLANS) {
      auth.session = { user: makeUser({ plan, isOrganizationAdmin: true }) }
      const { unmount } = await mountUserBar()
      const controls = [...document.querySelectorAll('a, button')].map(textOf)
      expect(controls).not.toContain(getText('upgrade'))
      expect(controls).not.toContain(getText('invite'))
      await user.click(userMenuButton())
      await flushPromises()
      expect(entryNames()).not.toContain(getText('upgradePlanShortcut'))
      unmount()
      await flushPromises()
    }
  })

  test('Settings and About close the menu and act; there is no Logout', async () => {
    const { goToSettingsPage } = await mountUserBar()
    const user = userEvent.setup()

    await user.click(userMenuButton())
    await flushPromises()
    await user.click(entry(getText('settingsShortcut')))
    await flushPromises()
    expect(goToSettingsPage).toHaveBeenCalledOnce()
    expect(userMenu()).toBeNull()

    await user.click(userMenuButton())
    await flushPromises()
    await user.click(entry(getText('aboutThisAppShortcut')))
    await flushPromises()
    expect(useAboutModal().isOpen.value).toBe(true)

    await user.click(userMenuButton())
    await flushPromises()
    expect(entryNames()).not.toContain(getText('signOutShortcut'))
  })

  test('the entries are global actions while the bar is mounted, the menu closed', async () => {
    const { goToSettingsPage, unmount } = await mountUserBar()
    const names = () =>
      useActionsStore()
        .findActions('')
        .map((action) => action.name)
    expect(names()).toContain(getText('settingsShortcut'))
    expect(names()).not.toContain(getText('signOutShortcut'))
    // `Mod+,` is Settings' default shortcut.
    await userEvent.setup().keyboard('{Control>},{/Control}')
    expect(goToSettingsPage).toHaveBeenCalledOnce()
    unmount()
    expect(names()).not.toContain(getText('settingsShortcut'))
  })

  test('the menu shows the shortcuts', async () => {
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    // The key of `Mod+,`, after its modifier.
    expect(entry(getText('settingsShortcut')).textContent).toMatch(/,$/)
  })

  test('offline, it says so', async () => {
    onlineManager.setOnline(false)
    await mountUserBar()
    expect(document.body.textContent).toContain(getText('youAreOffline'))
  })
})

describe('NotificationTray', () => {
  const trayButton = () =>
    must(document.querySelector<HTMLElement>(`button[aria-label="${getText('notifications')}"]`))
  const tray = () => must(document.querySelector<HTMLElement>(`[role="dialog"]`))

  test('empty: "You are all caught up"', async () => {
    await mountUserBar()
    await userEvent.setup().click(trayButton())
    await flushPromises()
    expect(tray().getAttribute('aria-label')).toBe(getText('notifications'))
    expect(textOf(tray().querySelector('h3'))).toBe(getText('notifications'))
    expect(tray().textContent).toContain(getText('youAreAllCaughtUp'))
  })
})
