/**
 * @file The User groups, Activity log, API keys and Usage settings tabs, with the sections the cloud
 * contributes (`$/cloud/organization`, `$/cloud/account`, `$/cloud/billing`): the groups with their
 * members, creating a group (and refusing a duplicate name), deleting one once confirmed, the team
 * plan's limit and its paywall, managing a group's members from the keyboard; the activity log with
 * its sorting and its type filter; the API keys, creating one (its secret shown once) and deleting
 * one; the month's execution usage.
 */
import {
  ACCOUNT_SETTINGS_SECTIONS,
  API_KEYS_SETTINGS_SECTIONS,
} from '$/cloud/account/settingsSections'
import { USAGE_SETTINGS_SECTIONS } from '$/cloud/billing/settingsSections'
import {
  ACTIVITY_LOG_SETTINGS_SECTIONS,
  USER_GROUPS_SETTINGS_SECTIONS,
} from '$/cloud/organization/settingsSections'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import type { SettingsContext, SettingsSectionData } from '$/configurations/settings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { createQueryClient } from '$/utils/queryClient'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  ApiKeyExpiresIn,
  ApiKeyId,
  EmailAddress,
  OrganizationId,
  Plan,
  ProjectId,
  UserGroupId,
  UserId,
  type ApiKey,
  type AuditLogEvent,
  type User,
  type UserGroupInfo,
} from 'enso-common/src/services/Backend'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h, markRaw, ref } from 'vue'
import SettingsTab from '../SettingsTab.vue'
import { required } from './dom'

const ORGANIZATION_ID = OrganizationId('organization-1')
const GROUP = {
  id: UserGroupId('usergroup-1'),
  groupName: 'Analysts',
  organizationId: ORGANIZATION_ID,
} as UserGroupInfo
const ADMIN = {
  userId: UserId('user-admin'),
  name: 'admin name',
  email: EmailAddress('admin@example.com'),
  organizationId: ORGANIZATION_ID,
  plan: Plan.team,
  isOrganizationAdmin: true,
  userGroups: [GROUP.id],
  groups: [{ id: GROUP.id, name: GROUP.groupName }],
} as unknown as User
const MEMBER = {
  userId: UserId('user-member'),
  name: 'member name',
  email: EmailAddress('member@example.com'),
  organizationId: ORGANIZATION_ID,
  plan: Plan.team,
  isOrganizationAdmin: false,
  userGroups: [],
  groups: [],
} as unknown as User
const API_KEY = {
  id: ApiKeyId('apikey-1'),
  secretId: null,
  name: 'ci',
  description: 'The CI key',
  createdAt: '2026-09-01T10:00:00Z',
  lastUsedAt: null,
  expiresIn: ApiKeyExpiresIn.Indefinetly,
  expiresAt: null,
} as unknown as ApiKey

const auth = vi.hoisted((): { session: unknown } => ({ session: null }))
const remote = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listUserGroups: vi.fn(),
  createUserGroup: vi.fn(),
  deleteUserGroup: vi.fn(),
  changeUserGroup: vi.fn(),
  getLogEvents: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  listExecutionsSummary: vi.fn(),
}))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ remoteBackend: remote }) }
})

const { getText } = useText()

beforeAll(() => {
  // jsdom has no layout; Reka scrolls the highlighted option into view.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Missing in jsdom.
  Element.prototype.scrollIntoView ??= () => {}
})

function makeContext(user: User = ADMIN) {
  return ref<SettingsContext>({
    accessToken: '',
    user,
    organization: null,
    localBackend: null,
    isCloudDataUnavailable: false,
    isAuthDisabled: false,
    getText,
    backend: remote as never,
    updateUser: vi.fn(() => Promise.resolve()),
    updateOrganization: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve(true)),
    preferredTimeZone: undefined,
    setPreferredTimeZone: vi.fn(),
    localRootDirectory: null,
    downloadDirectory: null,
  })
}

/** A tab with the given sections, and the modal stack its confirmations open on. */
async function mountTab(sections: readonly SettingsSectionData[], context = makeContext()) {
  auth.session = { user: context.value.user }
  const Page = () => h('div', [h(SettingsTab, { sections: markRaw([...sections]) }), h(ModalHost)])
  // The app's query client, which applies a mutation's invalidations.
  const queryClient = await createQueryClient()
  const mounted = await mountWithProviders(Page, {
    queryClient,
    stores: { settingsContext: context },
  })
  await flushPromises()
  return mounted
}

const buttonIn = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find(
    (button) => button.textContent.trim() === name || button.getAttribute('aria-label') === name,
  )
const rowOf = (text: string) =>
  required(
    [...document.querySelectorAll<HTMLElement>('tbody tr')].find((tr) =>
      tr.textContent.includes(text),
    ),
    text,
  )
/** The rows' texts, without the activity log's loading row. */
const rowTexts = () =>
  [...document.querySelectorAll('tbody tr')]
    .map((tr) => tr.textContent.replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '')
const openDialog = (role = 'dialog') =>
  required(document.querySelector<HTMLElement>(`[role="${role}"]`), role)

beforeEach(() => {
  vi.resetAllMocks()
  useModals().closeAll()
  remote.listUsers.mockResolvedValue([ADMIN, MEMBER])
  remote.listUserGroups.mockResolvedValue([GROUP])
  remote.createUserGroup.mockResolvedValue({ ...GROUP, id: UserGroupId('usergroup-2') })
  remote.deleteUserGroup.mockResolvedValue(undefined)
  remote.changeUserGroup.mockResolvedValue(undefined)
  // As in React, the log asks for the next page while it does not fill its view, which in jsdom
  // (no layout) is always: the second page never answers, so that the tests see one request.
  remote.getLogEvents.mockImplementation(({ from }: { from: number }) =>
    from === 0 ? Promise.resolve([]) : new Promise(() => {}),
  )
  remote.listApiKeys.mockResolvedValue([API_KEY])
  remote.deleteApiKey.mockResolvedValue(undefined)
  remote.listExecutionsSummary.mockResolvedValue([])
})

describe('User groups tab', () => {
  test('lists the groups with their members, and the groups left on the team plan', async () => {
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    const table = required(document.querySelector('table'))
    expect(table.getAttribute('aria-label')).toBe(getText('userGroups'))
    expect([...table.querySelectorAll('th')].map((th) => th.textContent.trim())).toEqual([
      getText('userGroup'),
      getText('users'),
      getText('actions'),
    ])
    const row = rowOf('Analysts')
    // The admin's picture, named by them.
    expect(row.querySelector('svg, img')).not.toBeNull()
    expect(buttonIn(row, getText('manageUsers'))).toBeDefined()
    expect(document.body.textContent).toContain(getText('userGroupsLimitMessage', 10, 9))
  })

  test('with no groups, says so', async () => {
    remote.listUserGroups.mockResolvedValue([])
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    expect(rowTexts()).toEqual([getText('youHaveNoUserGroupsAdmin')])
    expect(remote.listUsers).not.toHaveBeenCalled()
  })

  test('a member who is not an admin sees the groups only', async () => {
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS, makeContext(MEMBER))
    expect(buttonIn(document, getText('newUserGroup'))).toBeUndefined()
    expect(buttonIn(document, getText('manageUsers'))).toBeUndefined()
    expect(document.querySelectorAll('th')).toHaveLength(2)
  })

  test('creates a group, refusing a name already taken', async () => {
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(document, getText('newUserGroup'))))
    await flushPromises()
    const popover = openDialog()
    const name = required(popover.querySelector<HTMLInputElement>('input'))
    await user.type(name, ' analysts ')
    await user.click(required(buttonIn(popover, getText('submit'))))
    await flushPromises()
    expect(popover.textContent).toContain(getText('duplicateUserGroupError'))
    expect(remote.createUserGroup).not.toHaveBeenCalled()
    await user.clear(name)
    await user.type(name, 'Engineers')
    await user.click(required(buttonIn(popover, getText('submit'))))
    await flushPromises()
    expect(remote.createUserGroup).toHaveBeenCalledWith({ name: 'Engineers' })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })

  test('at the limit, "New User Group" opens the paywall instead', async () => {
    remote.listUserGroups.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        ...GROUP,
        id: UserGroupId(`usergroup-${i}`),
        groupName: `Group ${i}`,
      })),
    )
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    expect(document.body.textContent).toContain(getText('userGroupsPaywallMessage'))
    await userEvent.setup().click(required(buttonIn(document, getText('newUserGroup'))))
    await flushPromises()
    expect(openDialog().textContent).toContain(getText('userGroupsFullFeatureLabel'))
  })

  test('deletes a group from its menu, once confirmed', async () => {
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    const row = rowOf('Analysts')
    const menuButton = required(
      [...row.querySelectorAll<HTMLElement>('button')].find((button) =>
        button.hasAttribute('aria-haspopup'),
      ),
    )
    menuButton.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    const item = required(document.querySelector<HTMLElement>('[role="menuitem"]'))
    expect(item.textContent.trim()).toBe(getText('delete'))
    await user.click(item)
    await flushPromises()
    const dialog = openDialog('alertdialog')
    expect(dialog.textContent).toContain(
      getText('confirmPrompt', getText('deleteUserGroupActionText', 'Analysts')),
    )
    await user.click(required(buttonIn(dialog, getText('delete'))))
    await flushPromises()
    expect(remote.deleteUserGroup).toHaveBeenCalledWith(GROUP.id, 'Analysts')
  })

  test("manages a group's members from the keyboard: add one, remove one, and go back", async () => {
    await mountTab(USER_GROUPS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    required(buttonIn(rowOf('Analysts'), getText('manageUsers'))).focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(document.body.textContent).toContain(getText('managingUserGroupX', 'Analysts'))
    expect(rowTexts()).toEqual([expect.stringContaining('admin@example.com')])

    // Add the other member, choosing them in the combo box with the keyboard.
    required(buttonIn(document, getText('addUsers'))).focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    const popover = openDialog()
    const comboBox = required(popover.querySelector<HTMLInputElement>('[role="combobox"]'))
    await user.click(comboBox)
    await user.keyboard('member')
    await flushPromises()
    await user.keyboard('{ArrowDown}{Enter}')
    await flushPromises()
    expect(comboBox.value).toBe('member name (member@example.com)')
    await user.click(required(buttonIn(popover, getText('addUser'))))
    await flushPromises()
    expect(remote.changeUserGroup).toHaveBeenCalledWith(
      MEMBER.userId,
      { userGroups: [GROUP.id] },
      'member name',
    )
    await user.click(required(buttonIn(popover, getText('done'))))
    await flushPromises()

    // Remove the admin, once confirmed.
    await user.click(required(buttonIn(rowOf('admin@example.com'), getText('remove'))))
    await flushPromises()
    const dialog = openDialog('alertdialog')
    expect(dialog.textContent).toContain(
      getText(
        'confirmPrompt',
        getText('removeUserFromUserGroupActionText', 'admin name', 'Analysts'),
      ),
    )
    await user.click(required(buttonIn(dialog, getText('delete'))))
    await flushPromises()
    expect(remote.changeUserGroup).toHaveBeenLastCalledWith(
      ADMIN.userId,
      { userGroups: [] },
      'admin name',
    )

    await user.click(required(buttonIn(document, getText('returnToGroupsList'))))
    await flushPromises()
    expect(rowOf('Analysts')).toBeDefined()
  })
})

describe('Activity log tab', () => {
  const EVENTS = [
    {
      organizationId: ORGANIZATION_ID,
      userEmail: MEMBER.email,
      timestamp: '2026-09-02T10:00:00Z',
      lambdaKind: 'POST /auth',
      projectId: null,
      metadata: null,
    },
    {
      organizationId: ORGANIZATION_ID,
      userEmail: ADMIN.email,
      timestamp: '2026-09-01T10:00:00Z',
      lambdaKind: 'GET /organizations/me',
      projectId: null,
      metadata: null,
    },
  ] as unknown as AuditLogEvent[]

  test('lists the events, and sorts them by user', async () => {
    remote.getLogEvents.mockImplementation(({ from }: { from: number }) =>
      from === 0 ? Promise.resolve(EVENTS) : new Promise(() => {}),
    )
    await mountTab(ACTIVITY_LOG_SETTINGS_SECTIONS)
    await vi.waitFor(() => expect(rowTexts()).toHaveLength(2))
    expect(remote.getLogEvents).toHaveBeenCalledWith(expect.objectContaining({ from: 0 }))
    expect(rowTexts()[0]).toContain('member name')
    const sortByUser = required(buttonIn(document, getText('sortByEmail')))
    await userEvent.setup().click(sortByUser)
    await flushPromises()
    expect(rowTexts()[0]).toContain('admin name')
    expect(sortByUser.getAttribute('aria-label')).toBe(getText('sortByEmailDescending'))
  })

  test('filters by type, asking the backend for that kind', async () => {
    await mountTab(ACTIVITY_LOG_SETTINGS_SECTIONS)
    const type = required(
      document.querySelector<HTMLInputElement>(
        `[role="combobox"][aria-label="${getText('type')}"]`,
      ),
    )
    const user = userEvent.setup()
    await user.click(type)
    await user.keyboard(getText('authLogEvent'))
    await flushPromises()
    await user.keyboard('{ArrowDown}{Enter}')
    await flushPromises()
    await vi.waitFor(() =>
      expect(remote.getLogEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ lambdaKind: 'POST /auth' }),
      ),
    )
  })
})

describe('API keys tab', () => {
  test('lists the keys, with how many more can be created', async () => {
    await mountTab(API_KEYS_SETTINGS_SECTIONS)
    expect(required(document.querySelector('table')).getAttribute('aria-label')).toBe(
      getText('apiKeys'),
    )
    const row = rowOf('The CI key')
    expect(row.textContent).toContain('ci')
    expect(row.textContent).toContain(getText('never'))
    expect(document.body.textContent).toContain(getText('youCanCreateXMoreApiKeys', 4))
  })

  test('with no keys, says so', async () => {
    remote.listApiKeys.mockResolvedValue([])
    await mountTab(API_KEYS_SETTINGS_SECTIONS)
    expect(rowTexts()).toEqual([getText('youHaveNoApiKeys')])
  })

  test('creates a key, then shows its secret once', async () => {
    remote.createApiKey.mockResolvedValue({
      ...API_KEY,
      id: ApiKeyId('apikey-2'),
      secretId: 'the-secret',
      name: 'deploy',
    })
    await mountTab(API_KEYS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(document, getText('newApiKey'))))
    await flushPromises()
    const popover = openDialog()
    const [name, description] = popover.querySelectorAll<HTMLInputElement>('input[type="text"]')
    await user.type(required(name), 'deploy')
    await user.type(required(description), 'Deployments')
    await user.click(
      required(
        [...popover.querySelectorAll('label')].find(
          (label) => label.textContent.trim() === String(ApiKeyExpiresIn.Month),
        ),
      ),
    )
    await user.click(required(buttonIn(popover, getText('submit'))))
    await flushPromises()
    expect(remote.createApiKey).toHaveBeenCalledWith({
      name: 'deploy',
      description: 'Deployments',
      expiresIn: ApiKeyExpiresIn.Month,
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain('the-secret'))
    expect(openDialog().textContent).toContain(getText('accessKeyAlert'))
  })

  test('deletes a key once confirmed', async () => {
    await mountTab(API_KEYS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(rowOf('The CI key'), getText('delete'))))
    await flushPromises()
    const dialog = openDialog('alertdialog')
    expect(dialog.textContent).toContain(
      getText('confirmPrompt', getText('deleteApiKeyConfirmation', 'ci')),
    )
    await user.click(required(buttonIn(dialog, getText('delete'))))
    await flushPromises()
    expect(remote.deleteApiKey).toHaveBeenCalledWith(API_KEY.id)
  })

  test('the API keys are a tab of their own, not a section of the Account tab', () => {
    expect(ACCOUNT_SETTINGS_SECTIONS.map((section) => section.nameId)).not.toContain(
      'apiKeysSettingsSection',
    )
  })
})

describe('Usage tab', () => {
  test("shows the current month's executions, and another month's once chosen", async () => {
    remote.listExecutionsSummary.mockResolvedValue([
      {
        user: { name: 'member name', email: MEMBER.email },
        project: { projectId: ProjectId('project-1'), name: 'Forecast' },
        totalSessions: 3,
        totalUptimeSeconds: 4080,
        averageUptimeSeconds: 1360,
      },
    ])
    await mountTab(USAGE_SETTINGS_SECTIONS)
    const now = new Date()
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(remote.listExecutionsSummary).toHaveBeenCalledWith({ month })
    expect(rowTexts()).toEqual([
      expect.stringMatching(/member name\s*Forecast\s*3\s*1h 08m\s*22m 40s/),
    ])
    const input = required(
      document.querySelector<HTMLInputElement>(
        `input[aria-label="${getText('executionSummaryMonthLabel')}"]`,
      ),
    )
    expect(input.value).toBe(month)
    remote.listExecutionsSummary.mockResolvedValue([])
    input.value = '2026-01'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(remote.listExecutionsSummary).toHaveBeenLastCalledWith({ month: '2026-01' })
    expect(rowTexts()).toEqual([getText('executionSummaryEmpty')])
  })
})
