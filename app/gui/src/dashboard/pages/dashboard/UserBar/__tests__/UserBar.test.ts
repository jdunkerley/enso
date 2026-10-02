/**
 * @file The Vue user bar (#83): the user menu (a dialog of buttons, as React's), its entries as
 * global actions, the notification tray, the offline notice and the cloud-only buttons.
 */
// The stores are plain objects, not React hooks: renamed so that the dashboard's rules-of-hooks
// lint does not take them for hooks.
import { useAboutModal as getAboutModal } from '$/components/AboutModal/aboutModal'
import { useActionsStore as getActionsStore } from '$/providers/actions'
import { useText as getTextStore } from '$/providers/text'
import { getToastsStore } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { onlineManager } from '@tanstack/vue-query'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  EmailAddress,
  OrganizationId,
  Plan,
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

const signOut = vi.fn(async () => {})
vi.mock('$/providers/session', () => ({ useSession: () => ({ signOut }) }))

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

const uploads = reactive(new Map<string, object>())
vi.mock('$/providers/upload', () => ({ useUploadsToCloudStore: () => ({ uploads }) }))

// The "Invite" button is a React leaf (#87); React's providers are not mounted here.
vi.mock('#/modals/InviteUsersModal/InviteUsersButton', () => ({
  InviteUsersButton: () => null,
}))

const { getText } = getTextStore()

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
  const onSignOut = vi.fn()
  const mounted = await mountWithProviders(UserBar, {
    props: { goToSettingsPage, onSignOut },
  })
  return { ...mounted, goToSettingsPage, onSignOut }
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
  signOut.mockClear()
})

afterEach(() => {
  getAboutModal().isOpen.value = false
  onlineManager.setOnline(true)
  uploads.clear()
  getToastsStore().dismiss()
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
    // As react-aria's: the dialog itself, then Tab to the entries.
    expect(document.activeElement).toBe(menu)
    expect(menu.textContent).toContain('Ada Lovelace')
    expect(menu.textContent).toContain(getText(Plan.solo))
    expect(entryNames()).toEqual([
      getText('settingsShortcut'),
      getText('aboutThisAppShortcut'),
      getText('upgradePlanShortcut'),
      getText('signOutShortcut'),
    ])
    await user.tab()
    expect(document.activeElement).toBe(entry(getText('settingsShortcut')))
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(userMenu()).toBeNull()
    expect(document.activeElement).toBe(userMenuButton())
  })

  test('"Download app" without a local backend; no "Upgrade Plan" on a paid plan', async () => {
    localBackend.value = null
    auth.session = { user: makeUser({ plan: Plan.team }) }
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([
      getText('downloadAppShortcut'),
      getText('settingsShortcut'),
      getText('aboutThisAppShortcut'),
      getText('signOutShortcut'),
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
    const names = getActionsStore()
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

  test('signed in to the cloud on the free plan, "Upgrade Plan" and "Logout" are there', async () => {
    auth.session = { user: makeUser({ plan: Plan.free }) }
    await mountUserBar()
    await userEvent.setup().click(userMenuButton())
    await flushPromises()
    expect(entryNames()).toEqual([
      getText('settingsShortcut'),
      getText('aboutThisAppShortcut'),
      getText('upgradePlanShortcut'),
      getText('signOutShortcut'),
    ])
    expect(must(userMenu()).textContent).toContain(getText(Plan.free))
  })

  test('Settings, About and Logout close the menu and act', async () => {
    const { goToSettingsPage, onSignOut } = await mountUserBar()
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
    expect(getAboutModal().isOpen.value).toBe(true)

    await user.click(userMenuButton())
    await flushPromises()
    await user.click(entry(getText('signOutShortcut')))
    await flushPromises()
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(signOut).toHaveBeenCalledOnce()
  })

  test('the entries are global actions while the bar is mounted, the menu closed', async () => {
    const { goToSettingsPage, unmount } = await mountUserBar()
    const names = () =>
      getActionsStore()
        .findActions('')
        .map((action) => action.name)
    expect(names()).toEqual(
      expect.arrayContaining([getText('settingsShortcut'), getText('signOutShortcut')]),
    )
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
    expect(textOf(entry(getText('signOutShortcut')))).toBe(getText('signOutShortcut'))
  })

  test('an organization admin on the free plan gets "Upgrade"', async () => {
    auth.session = { user: makeUser({ isOrganizationAdmin: true, plan: Plan.free }) }
    const { router } = await mountUserBar()
    const upgrade = must(
      [...document.querySelectorAll('a')].find((link) => textOf(link) === getText('upgrade')),
    )
    expect(upgrade.getAttribute('href')).toBe('/subscribe')
    await userEvent.setup().click(upgrade)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/subscribe')
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

  test('an upload: a notification with a toast, and a badge until the tray is opened', async () => {
    await mountUserBar()
    const badge = () => must(trayButton().querySelector('[class*="after:bg-danger"]'))
    uploads.set('upload-1', {
      kind: 'requestedByUser',
      sentBytes: 500_000,
      totalBytes: 2_000_000,
    })
    await flushPromises()
    const message = getText('uploadingXFilesWithProgressNotification', 0, 1, '0.50', '2')
    const toast = must(getToastsStore().toasts.value.find((t) => t.id === 'upload-1'))
    expect(toast.isLoading).toBe(true)
    expect(toast.position).toBe('bottom-right')
    expect(toast.progress).toBe(0.25)
    expect(badge().classList).not.toContain('invisible')

    await userEvent.setup().click(trayButton())
    await flushPromises()
    const items = [...tray().querySelectorAll('[role="listitem"]')]
    expect(items).toHaveLength(1)
    const [item] = items
    expect(item?.textContent).toContain(message)
    expect(item?.querySelector('[role="progressbar"]')).not.toBeNull()
    // Seen: the badge goes.
    expect(badge().classList).toContain('invisible')
  })
})
