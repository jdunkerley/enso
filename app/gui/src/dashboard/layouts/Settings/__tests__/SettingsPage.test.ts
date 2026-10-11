/**
 * @file The Vue settings page's shell: the sidebar, the `SettingsTab` query parameter (deep links,
 * invalid values), the search, and the cloud's contributed sections and paywall.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import type * as QueryParamsModule from '$/providers/queryParams'
import { useSettingsContext } from '$/providers/settingsContext'
import {
  contributeSettingsPaywall,
  contributeSettingsSections,
  loadSettingsContributions,
  resetSettingsContributions,
} from '$/providers/settingsContributions'
import { useText } from '$/providers/text'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { Path, Plan, type User } from 'enso-common/src/services/Backend'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import { z } from 'zod'
import SettingsPage from '../SettingsPage.vue'
import { required } from './dom'

const USER = {
  name: 'user name',
  email: 'user@example.com',
  plan: Plan.solo,
  isOrganizationAdmin: false,
} as User

const auth = vi.hoisted(() => {
  const value: { session: unknown; deleteUser: () => void } = {
    session: null,
    deleteUser: () => {},
  }
  return value
})
const backends = vi.hoisted(() => ({
  hasLocalBackend: true,
  organization: null as { readonly subscription?: object } | null,
}))
const paywall = vi.hoisted(() => ({ locked: new Set<string>() }))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/composables/paywall', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useIsFeatureUnderPaywall: () => (feature: string) => paywall.locked.has(feature),
}))
// The global store keeps the first router it sees; each test has its own.
vi.mock('$/providers/queryParams', async (importOriginal) => {
  const original = await importOriginal<typeof QueryParamsModule>()
  return { ...original, useQueryParams: () => original.createQueryParams() }
})
vi.mock('$/providers/session', () => ({ useSession: () => ({ changePassword: vi.fn() }) }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () =>
      mockBackends({
        remoteBackend: { getOrganization: vi.fn(() => Promise.resolve(backends.organization)) },
        localBackend: backends.hasLocalBackend ? { rootPath: () => Path('/projects') } : null,
      }),
  }
})
const { getText } = useText()
const TAB_PARAM = 'cloud-ide_SettingsTab'

/** A contributed entry, showing what it reads from the settings context. */
const ContributedEntry = () =>
  h('p', { 'data-testid': 'contributed' }, `hello ${useSettingsContext().value.user.name}`)

beforeAll(() => {
  // `App.vue` registers it, which every page of the app loads first.
  LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
})

beforeEach(async () => {
  auth.session = {
    user: USER,
    email: USER.email,
    accessToken: `.${btoa(JSON.stringify({ username: USER.email }))}.`,
  }
  backends.hasLocalBackend = true
  backends.organization = null
  paywall.locked.clear()
  contributeSettingsSections(SettingsTabType.account, () =>
    Promise.resolve([
      {
        nameId: 'userAccountSettingsSection',
        entries: [
          {
            type: 'custom',
            aliasesId: 'profilePictureSettingsCustomEntryAliases',
            component: ContributedEntry,
          },
        ],
      },
    ]),
  )
  await loadSettingsContributions()
})

afterEach(() => {
  resetSettingsContributions()
})

const sidebar = () =>
  required(document.querySelectorAll(`[aria-label="${getText('settingsSidebarLabel')}"]`)[0])
const sidebarTabs = () =>
  [...sidebar().querySelectorAll('button')].map((button) => button.textContent.trim())
const sidebarButton = (name: string) =>
  required(
    [...sidebar().querySelectorAll<HTMLElement>('button')].find(
      (button) => button.textContent.trim() === name,
    ),
  )
const headings = () =>
  [...document.querySelectorAll('[data-testid="settings-panel"] main h2')].map((heading) =>
    heading.textContent.trim(),
  )
const searchBox = () => required(document.querySelector<HTMLInputElement>('input[type="search"]'))

describe('SettingsPage', () => {
  test('lists the visible tabs in their groups, and opens the Account tab', async () => {
    await mountWithProviders(SettingsPage)
    expect(sidebarTabs()).toEqual([
      getText('accountSettingsTab'),
      getText('localSettingsTab'),
      getText('appearanceSettingsTab'),
      getText('keyboardShortcutsSettingsTab'),
    ])
    expect([...sidebar().querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual([
      getText('generalSettingsTabSection'),
      getText('lookAndFeelSettingsTabSection'),
    ])
    expect(document.querySelector('h1.flex')?.textContent).toContain('user name')
    expect(sidebarButton(getText('accountSettingsTab')).className).toContain('bg-white')
    expect(document.querySelector('[data-testid="contributed"]')?.textContent).toBe(
      'hello user name',
    )
    expect(document.querySelector('[data-testid="offline-user-settings"]')).toBeNull()
  })

  test('in local-only mode, the Account tab shows the offline user', async () => {
    const offlineUser = { ...USER, name: getText('offlineUserName'), plan: Plan.free }
    auth.session = {
      user: offlineUser,
      email: 'local@enso.localhost',
      accessToken: '',
      isCloudDataUnavailable: true,
      isAuthDisabled: true,
    }
    await mountWithProviders(SettingsPage)
    expect(document.querySelector('h1.flex')?.textContent).toContain(getText('offlineUserName'))
    expect(sidebarButton(getText('accountSettingsTab')).className).toContain('bg-white')
    const offline = required(
      document.querySelector<HTMLElement>('[data-testid="offline-user-settings"]'),
    )
    expect(headings()[0]).toBe(getText('offlineUserSettingsSection'))
    expect(offline.querySelector('[data-testid="offline-user-name"]')?.textContent.trim()).toBe(
      getText('offlineUserName'),
    )
    expect(offline.textContent).toContain(getText('offlineUserStatus'))
    expect(offline.textContent).toContain(getText('offlineUserDescription'))
    // The default picture: there is no account to have one.
    expect(offline.querySelector('img')).toBeNull()
    expect(offline.querySelector('svg')).not.toBeNull()
  })

  test("hides the organization's tabs when the cloud does not fill them", async () => {
    const admin = { ...USER, plan: Plan.team, isOrganizationAdmin: true }
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    backends.organization = { subscription: {} }
    await mountWithProviders(SettingsPage)
    await flushPromises()
    expect(sidebarTabs()).not.toContain(getText('organizationSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('billingAndPlansSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('membersSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('userGroupsSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('activityLogSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('apiKeysSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('usageSettingsTab'))
  })

  test("lists the organization's tabs once the cloud fills them", async () => {
    const admin = { ...USER, plan: Plan.team, isOrganizationAdmin: true }
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    const section =
      (
        nameId:
          | 'activityLogSettingsSection'
          | 'apiKeysSettingsSection'
          | 'billingAndPlansSettingsSection'
          | 'membersSettingsSection'
          | 'organizationSettingsSection'
          | 'usageSettingsSection'
          | 'userGroupsSettingsSection',
      ) =>
      () =>
        Promise.resolve([
          { nameId, entries: [{ type: 'custom' as const, component: ContributedEntry }] },
        ])
    contributeSettingsSections(SettingsTabType.organization, section('organizationSettingsSection'))
    contributeSettingsSections(
      SettingsTabType.billingAndPlans,
      section('billingAndPlansSettingsSection'),
    )
    contributeSettingsSections(SettingsTabType.members, section('membersSettingsSection'))
    contributeSettingsSections(SettingsTabType.userGroups, section('userGroupsSettingsSection'))
    contributeSettingsSections(SettingsTabType.activityLog, section('activityLogSettingsSection'))
    contributeSettingsSections(SettingsTabType.apiKeys, section('apiKeysSettingsSection'))
    contributeSettingsSections(SettingsTabType.usage, section('usageSettingsSection'))
    await loadSettingsContributions()
    // Billing & Plans is listed for an organization with a subscription.
    backends.organization = { subscription: {} }
    await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"members"')}`,
    })
    await flushPromises()
    expect(sidebarTabs()).toEqual([
      getText('accountSettingsTab'),
      getText('organizationSettingsTab'),
      getText('localSettingsTab'),
      getText('billingAndPlansSettingsTab'),
      getText('membersSettingsTab'),
      getText('userGroupsSettingsTab'),
      getText('appearanceSettingsTab'),
      getText('keyboardShortcutsSettingsTab'),
      getText('activityLogSettingsTab'),
      getText('apiKeysSettingsTab'),
      getText('usageSettingsTab'),
    ])
    expect(headings()).toEqual([getText('membersSettingsSection')])
    // An organization's tab is titled with the organization, here the placeholder.
    expect(document.querySelector('h1.flex')?.textContent).toContain('your organization')
  })

  test("shows the contributed paywall in place of a tab the user's plan lacks", async () => {
    const admin = { ...USER, plan: Plan.team, isOrganizationAdmin: true }
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    paywall.locked.add('inviteUser')
    contributeSettingsSections(SettingsTabType.members, () =>
      Promise.resolve([
        {
          nameId: 'membersSettingsSection',
          entries: [{ type: 'custom' as const, component: ContributedEntry }],
        },
      ]),
    )
    const Paywall = (props: { feature: string }) =>
      h('p', { 'data-testid': 'paywall' }, `locked ${props.feature}`)
    Paywall.props = ['feature']
    contributeSettingsPaywall(() => Promise.resolve(Paywall))
    await loadSettingsContributions()
    await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"members"')}`,
    })
    expect(document.querySelector('[data-testid="paywall"]')?.textContent).toBe('locked inviteUser')
    expect(headings()).toEqual([])
    expect(document.querySelector('[data-testid="contributed"]')).toBeNull()
  })

  test('hides the Local tab without a local backend', async () => {
    backends.hasLocalBackend = false
    await mountWithProviders(SettingsPage)
    expect(sidebarTabs()).not.toContain(getText('localSettingsTab'))
  })

  test('opens the tab a link names', async () => {
    await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"keyboard-shortcuts"')}`,
    })
    expect(sidebarButton(getText('keyboardShortcutsSettingsTab')).className).toContain('bg-white')
    expect(headings()).toEqual([getText('keyboardShortcutsSettingsSection')])
  })

  test('keeps the current tab in the query, without it for the Account tab', async () => {
    const { router } = await mountWithProviders(SettingsPage, { route: '/settings' })
    const user = userEvent.setup()
    await user.click(sidebarButton(getText('appearanceSettingsTab')))
    await flushPromises()
    expect(router.currentRoute.value.query[TAB_PARAM]).toBe('"appearance"')
    expect(headings()).toEqual([getText('codeSettingsSection')])
    await user.click(sidebarButton(getText('accountSettingsTab')))
    await flushPromises()
    expect(router.currentRoute.value.query[TAB_PARAM]).toBeUndefined()
  })

  test('drops an invalid tab from the query, and shows the Account tab', async () => {
    const { router } = await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"no-such-tab"')}`,
    })
    await flushPromises()
    expect(router.currentRoute.value.query[TAB_PARAM]).toBeUndefined()
    expect(sidebarButton(getText('accountSettingsTab')).className).toContain('bg-white')
  })

  test('lists Billing & Plans only for an admin of an organization with a subscription', async () => {
    contributeSettingsSections(SettingsTabType.billingAndPlans, () =>
      Promise.resolve([
        {
          nameId: 'billingAndPlansSettingsSection',
          entries: [
            {
              type: 'custom' as const,
              aliasesId: 'billingAndPlansSettingsCustomEntryAliases' as const,
              component: ContributedEntry,
            },
          ],
        },
      ]),
    )
    await loadSettingsContributions()
    const admin = { ...USER, isOrganizationAdmin: true }
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    // No organization: no subscription.
    let { unmount } = await mountWithProviders(SettingsPage)
    await flushPromises()
    expect(sidebarTabs()).not.toContain(getText('billingAndPlansSettingsTab'))
    unmount()
    // Not the admin.
    backends.organization = { subscription: {} }
    auth.session = { user: USER, email: USER.email, accessToken: '' }
    ;({ unmount } = await mountWithProviders(SettingsPage))
    await flushPromises()
    expect(sidebarTabs()).not.toContain(getText('billingAndPlansSettingsTab'))
    unmount()
    // The admin of an organization with a subscription.
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    await mountWithProviders(SettingsPage)
    await flushPromises()
    expect(sidebarTabs()).toContain(getText('billingAndPlansSettingsTab'))
    await userEvent.setup().click(sidebarButton(getText('billingAndPlansSettingsTab')))
    await flushPromises()
    expect(headings()).toEqual([getText('billingAndPlansSettingsSection')])
    expect(document.querySelector('[data-testid="contributed"]')?.textContent).toBe(
      'hello user name',
    )
  })

  test('the search narrows the tabs, sections and entries', async () => {
    await mountWithProviders(SettingsPage)
    const user = userEvent.setup()
    // By an entry's aliases.
    await user.type(searchBox(), 'ligatures')
    await flushPromises()
    expect(sidebarTabs()).toEqual([getText('appearanceSettingsTab')])
    expect(headings()).toEqual([getText('codeSettingsSection')])
    expect(document.body.textContent).toContain(getText('codeLigaturesSetting'))
    expect(document.body.textContent).not.toContain(getText('handwrittenCommentsSetting'))
    // By a form input's label.
    await user.clear(searchBox())
    await user.type(searchBox(), 'root folder')
    await flushPromises()
    expect(sidebarTabs()).toEqual([getText('localSettingsTab')])
    // By a rebindable action's name.
    await user.clear(searchBox())
    await user.type(searchBox(), getText('duplicateShortcut'))
    await flushPromises()
    expect(sidebarTabs()).toContain(getText('keyboardShortcutsSettingsTab'))
    // By a contributed entry's aliases, keeping only that section.
    await user.clear(searchBox())
    await user.type(searchBox(), 'profile picture')
    await flushPromises()
    expect(sidebarTabs()).toEqual([getText('accountSettingsTab')])
    expect(document.querySelector('[data-testid="contributed"]')).not.toBeNull()
    // Nothing.
    await user.clear(searchBox())
    await user.type(searchBox(), 'zzzz')
    await flushPromises()
    expect(sidebarTabs()).toEqual([])
    expect(document.body.textContent).toContain(getText('noResultsFound'))
  })

  test('the search finds Billing & Plans by its aliases', async () => {
    contributeSettingsSections(SettingsTabType.billingAndPlans, () =>
      Promise.resolve([
        {
          nameId: 'billingAndPlansSettingsSection',
          entries: [
            {
              type: 'custom' as const,
              aliasesId: 'billingAndPlansSettingsCustomEntryAliases' as const,
              component: ContributedEntry,
            },
          ],
        },
      ]),
    )
    await loadSettingsContributions()
    const admin = { ...USER, isOrganizationAdmin: true }
    auth.session = { user: admin, email: admin.email, accessToken: '' }
    backends.organization = { subscription: {} }
    await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"billing-and-plans"')}`,
    })
    await flushPromises()
    await userEvent.setup().type(searchBox(), 'billing and plans')
    await flushPromises()
    expect(sidebarTabs()).toContain(getText('billingAndPlansSettingsTab'))
    expect(sidebarTabs()).not.toContain(getText('accountSettingsTab'))
    expect(headings()).toEqual([getText('billingAndPlansSettingsSection')])
    expect(document.querySelector('[data-testid="contributed"]')).not.toBeNull()
  })
})
