/**
 * @file The Vue settings page's shell: the sidebar, the `SettingsTab` query parameter (deep links,
 * invalid values), the search, the cloud's contributed sections, and the React tabs it mounts.
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
  const value: { session: unknown; deleteUser: () => void } = {
    session: null,
    deleteUser: () => {},
  }
  return value
})
const backends = vi.hoisted(() => ({ hasLocalBackend: true }))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
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
        remoteBackend: { getOrganization: vi.fn(() => Promise.resolve(null)) },
        localBackend: backends.hasLocalBackend ? { rootPath: () => Path('/projects') } : null,
      }),
  }
})
// The React tabs are not under test: each renders its tab's name.
vi.mock('$/utils/react', async () => {
  const { h: render } = await import('vue')
  /** Stands for each React tab: its name, and the search query it was given. */
  const ReactTab = (props: { data: { nameId: string }; query: string }) =>
    render('div', { 'data-testid': 'react-tab' }, `${props.data.nameId} ${props.query}`)
  ReactTab.props = ['data', 'query']
  return { reactComponent: () => ReactTab }
})
vi.mock('../data', async () => {
  const { default: TabType } = await import('$/configurations/settingsTabs')
  const tab = (settingsTab: SettingsTabType, nameId: string, visible?: () => boolean) => ({
    nameId,
    settingsTab,
    react: true,
    icon: 'settings',
    visible,
    sections: [{ nameId: `${nameId}Section`, entries: [] }],
  })
  return {
    REACT_SETTINGS_TAB_DATA: {
      [TabType.organization]: tab(TabType.organization, 'organizationSettingsTab', () => false),
      [TabType.billingAndPlans]: tab(TabType.billingAndPlans, 'billingAndPlansSettingsTab'),
      [TabType.members]: tab(TabType.members, 'membersSettingsTab', () => false),
      [TabType.userGroups]: tab(TabType.userGroups, 'userGroupsSettingsTab', () => false),
      [TabType.activityLog]: tab(TabType.activityLog, 'activityLogSettingsTab', () => false),
      [TabType.apiKeys]: tab(TabType.apiKeys, 'apiKeysSettingsTab'),
      [TabType.usage]: tab(TabType.usage, 'usageSettingsTab'),
    },
  }
})

const { getText } = useText()
const TAB_PARAM = 'cloud-ide_SettingsTab'

/** A contributed entry, showing what it reads from the settings context. */
const ContributedEntry = () =>
  h('p', { 'data-testid': 'contributed' }, `hello ${useSettingsContext().value.user.name}`)

beforeAll(() => {
  // The React `App.tsx` registers it, which every page of the app loads first.
  LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
})

beforeEach(async () => {
  auth.session = {
    user: USER,
    email: USER.email,
    accessToken: `.${btoa(JSON.stringify({ username: USER.email }))}.`,
  }
  backends.hasLocalBackend = true
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
      getText('billingAndPlansSettingsTab'),
      getText('appearanceSettingsTab'),
      getText('keyboardShortcutsSettingsTab'),
      getText('apiKeysSettingsTab'),
      getText('usageSettingsTab'),
    ])
    expect([...sidebar().querySelectorAll('h1')].map((heading) => heading.textContent)).toEqual([
      getText('generalSettingsTabSection'),
      getText('accessSettingsTabSection'),
      getText('lookAndFeelSettingsTabSection'),
      getText('securitySettingsTabSection'),
      getText('usageSettingsTabSection'),
    ])
    expect(document.querySelector('h1.flex')?.textContent).toContain('user name')
    expect(sidebarButton(getText('accountSettingsTab')).className).toContain('bg-white')
    expect(document.querySelector('[data-testid="contributed"]')?.textContent).toBe(
      'hello user name',
    )
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

  test('mounts the React tabs with the search query', async () => {
    await mountWithProviders(SettingsPage)
    await userEvent.setup().click(sidebarButton(getText('billingAndPlansSettingsTab')))
    await flushPromises()
    expect(document.querySelector('[data-testid="react-tab"]')?.textContent.trim()).toBe(
      'billingAndPlansSettingsTab',
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

  test('passes the search on to a React tab', async () => {
    await mountWithProviders(SettingsPage, {
      route: `/settings?${TAB_PARAM}=${encodeURIComponent('"usage"')}`,
    })
    await userEvent.setup().type(searchBox(), 'usage')
    await flushPromises()
    expect(document.querySelector('[data-testid="react-tab"]')?.textContent).toBe(
      'usageSettingsTab usage',
    )
  })
})
