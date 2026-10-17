/**
 * @file The Vue settings page's shell: the sidebar, the `SettingsTab` query parameter (deep links,
 * invalid values), the search and the contributed sections; the cloud's tabs are gone.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import type * as QueryParamsModule from '$/providers/queryParams'
import { useSettingsContext } from '$/providers/settingsContext'
import {
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
  const value: { session: unknown } = { session: null }
  return value
})
const backends = vi.hoisted(() => ({
  hasLocalBackend: true,
  organization: null as { readonly subscription?: object } | null,
}))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
// The global store keeps the first router it sees; each test has its own.
vi.mock('$/providers/queryParams', async (importOriginal) => {
  const original = await importOriginal<typeof QueryParamsModule>()
  return { ...original, useQueryParams: () => original.createQueryParams() }
})
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
  // Both flags are part of the session's type; `false` keeps the cloud-era tabs under test.
  auth.session = {
    user: USER,
    email: USER.email,
    accessToken: `.${btoa(JSON.stringify({ username: USER.email }))}.`,
    isCloudDataUnavailable: false,
    isAuthDisabled: false,
  }
  backends.hasLocalBackend = true
  backends.organization = null
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

  test('lists only the local tabs, whatever is contributed', async () => {
    // An admin of an organization with a subscription: the cloud's tabs would all be listed.
    const admin = { ...USER, plan: Plan.team, isOrganizationAdmin: true }
    auth.session = {
      user: admin,
      email: admin.email,
      accessToken: '',
      isCloudDataUnavailable: false,
      isAuthDisabled: false,
    }
    backends.organization = { subscription: {} }
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
    await mountWithProviders(SettingsPage)
    await flushPromises()
    expect(sidebarTabs()).toEqual([
      getText('accountSettingsTab'),
      getText('localSettingsTab'),
      getText('appearanceSettingsTab'),
      getText('keyboardShortcutsSettingsTab'),
    ])
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
})
