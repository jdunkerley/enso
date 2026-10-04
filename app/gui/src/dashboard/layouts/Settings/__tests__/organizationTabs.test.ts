/**
 * @file The Organization and Members settings tabs, with the sections the cloud contributes
 * (`$/cloud/organization`): the organization's form (Save, Cancel, validation, a refused save, the
 * read-only view of a member who is not an admin) and its picture; the members and invitations,
 * removing a member once confirmed, resending and removing an invitation, the seats left with their
 * paywall dialog, and the keyboard path to the invitation dialog.
 */
import {
  MEMBERS_SETTINGS_SECTIONS,
  ORGANIZATION_SETTINGS_SECTIONS,
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
  EmailAddress,
  OrganizationId,
  Plan,
  UserId,
  type OrganizationInfo,
  type User,
} from 'enso-common/src/services/Backend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { h, markRaw, ref } from 'vue'
import SettingsTab from '../SettingsTab.vue'
import { required } from './dom'

const ORGANIZATION_ID = OrganizationId('organization-1')
const ADMIN = {
  userId: UserId('user-admin'),
  name: 'admin name',
  email: EmailAddress('admin@example.com'),
  organizationId: ORGANIZATION_ID,
  plan: Plan.team,
  isOrganizationAdmin: true,
} as User
const MEMBER = {
  userId: UserId('user-member'),
  name: 'member name',
  email: EmailAddress('member@example.com'),
  organizationId: ORGANIZATION_ID,
  plan: Plan.team,
  isOrganizationAdmin: false,
} as User
const ORGANIZATION = {
  id: ORGANIZATION_ID,
  name: 'The Organization',
  email: null,
  website: null,
  address: null,
  picture: null,
} as OrganizationInfo

const auth = vi.hoisted((): { session: unknown } => ({ session: null }))
const remote = vi.hoisted(() => ({
  getOrganization: vi.fn(),
  uploadOrganizationPicture: vi.fn(),
  listUsers: vi.fn(),
  listInvitations: vi.fn(),
  removeUser: vi.fn(),
  resendInvitation: vi.fn(),
  deleteInvitation: vi.fn(),
}))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ remoteBackend: remote }) }
})

const { getText } = useText()

function makeContext(user: User = ADMIN, overrides: Partial<SettingsContext> = {}) {
  return ref<SettingsContext>({
    accessToken: '',
    user,
    organization: ORGANIZATION,
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
    ...overrides,
  })
}

/** A tab with the given sections, and the modal stack its confirmations open on. */
async function mountTab(sections: readonly SettingsSectionData[], context = makeContext()) {
  auth.session = { user: context.value.user }
  const Page = () =>
    // `markRaw`: the sections hold components.
    h('div', [h(SettingsTab, { sections: markRaw([...sections]) }), h(ModalHost)])
  // The app's query client, which applies a mutation's invalidations.
  const queryClient = await createQueryClient()
  const mounted = await mountWithProviders(Page, {
    queryClient,
    stores: { settingsContext: context },
  })
  await flushPromises()
  return { ...mounted, context }
}

const section = (nameId: Parameters<typeof getText>[0]) =>
  required(
    [...document.querySelectorAll('h2')].find(
      (heading) => heading.textContent.trim() === getText(nameId),
    )?.parentElement as HTMLElement | undefined,
    nameId,
  )
const buttonIn = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find(
    (button) => button.textContent.trim() === name || button.getAttribute('aria-label') === name,
  )
const inputLabelled = (container: ParentNode, label: string) => {
  const field = [...container.querySelectorAll<HTMLElement>('[aria-labelledby]')].find(
    (element) =>
      document
        .getElementById(required(element.getAttribute('aria-labelledby')))
        ?.textContent.trim() === label,
  )
  return required(field?.querySelector<HTMLInputElement>('input'), label)
}
const rowOf = (text: string) =>
  required(
    [...document.querySelectorAll<HTMLElement>('tbody tr')].find((tr) =>
      tr.textContent.includes(text),
    ),
    text,
  )

beforeEach(() => {
  vi.resetAllMocks()
  useModals().closeAll()
  remote.getOrganization.mockResolvedValue(ORGANIZATION)
  remote.listUsers.mockResolvedValue([ADMIN, MEMBER])
  remote.listInvitations.mockResolvedValue({
    invitations: [
      { userEmail: EmailAddress('pending@example.com'), organizationId: ORGANIZATION_ID },
    ],
    availableLicenses: 3,
    maxLicenses: 5,
  })
  remote.removeUser.mockResolvedValue(undefined)
  remote.resendInvitation.mockResolvedValue(undefined)
  remote.deleteInvitation.mockResolvedValue(undefined)
})

describe('Organization tab', () => {
  test('shows the organization, with its picture beside the form', async () => {
    await mountTab(ORGANIZATION_SETTINGS_SECTIONS)
    expect(
      [...document.querySelectorAll('h2')].map((heading) => heading.textContent.trim()),
    ).toEqual([
      getText('organizationSettingsSection'),
      getText('organizationProfilePictureSettingsSection'),
    ])
    const form = section('organizationSettingsSection')
    expect(inputLabelled(form, getText('organizationNameSettingsInput')).value).toBe(
      'The Organization',
    )
    expect(inputLabelled(form, getText('organizationEmailSettingsInput')).value).toBe('')
    expect(buttonIn(form, getText('save'))).toBeUndefined()
    expect(
      document.querySelector('[data-testid="organization-profile-picture-input"]'),
    ).not.toBeNull()
    expect(document.body.textContent).toContain(getText('organizationProfilePictureWarning'))
  })

  test('Save sends every field; Cancel restores them', async () => {
    const { context } = await mountTab(ORGANIZATION_SETTINGS_SECTIONS)
    const form = section('organizationSettingsSection')
    const user = userEvent.setup()
    const name = inputLabelled(form, getText('organizationNameSettingsInput'))
    await user.clear(name)
    await user.type(name, 'New name')
    await user.click(required(buttonIn(form, getText('cancel'))))
    await flushPromises()
    expect(name.value).toBe('The Organization')
    await user.type(inputLabelled(form, getText('organizationWebsiteSettingsInput')), 'org.org')
    await user.click(required(buttonIn(form, getText('save'))))
    await flushPromises()
    expect(context.value.updateOrganization).toHaveBeenCalledWith({
      name: 'The Organization',
      email: '',
      website: 'org.org',
      address: '',
    })
  })

  test('an invalid email is refused before anything is sent', async () => {
    const { context } = await mountTab(ORGANIZATION_SETTINGS_SECTIONS)
    const form = section('organizationSettingsSection')
    const user = userEvent.setup()
    await user.type(inputLabelled(form, getText('organizationEmailSettingsInput')), 'invalid@email')
    await user.click(required(buttonIn(form, getText('save'))))
    await flushPromises()
    expect(context.value.updateOrganization).not.toHaveBeenCalled()
    expect(form.querySelector('[aria-invalid="true"]')).not.toBeNull()
  })

  test('a save the server refuses shows its error, and keeps the edit', async () => {
    const updateOrganization = vi.fn(() => Promise.reject(new Error('Name must not be empty')))
    await mountTab(ORGANIZATION_SETTINGS_SECTIONS, makeContext(ADMIN, { updateOrganization }))
    const form = section('organizationSettingsSection')
    const user = userEvent.setup()
    await user.clear(inputLabelled(form, getText('organizationNameSettingsInput')))
    await user.click(required(buttonIn(form, getText('save'))))
    await flushPromises()
    expect(updateOrganization).toHaveBeenCalledWith(expect.objectContaining({ name: '' }))
    expect(form.textContent).toContain('Name must not be empty')
    expect(buttonIn(form, getText('save'))).toBeDefined()
  })

  test('a member who is not an admin sees the organization read-only', async () => {
    await mountTab(ORGANIZATION_SETTINGS_SECTIONS, makeContext(MEMBER))
    const form = section('organizationSettingsSection')
    for (const label of [
      'organizationNameSettingsInput',
      'organizationEmailSettingsInput',
      'organizationWebsiteSettingsInput',
      'organizationLocationSettingsInput',
    ] as const) {
      expect(inputLabelled(form, getText(label)).readOnly).toBe(true)
    }
  })

  test('choosing a picture uploads it', async () => {
    remote.uploadOrganizationPicture.mockResolvedValue(ORGANIZATION)
    await mountTab(ORGANIZATION_SETTINGS_SECTIONS)
    const input = required(
      document.querySelector<HTMLInputElement>(
        '[data-testid="organization-profile-picture-input"] input[type="file"]',
      ),
    )
    const picture = new File(['picture'], 'logo.png', { type: 'image/png' })
    await userEvent.setup().upload(input, picture)
    await flushPromises()
    expect(remote.uploadOrganizationPicture).toHaveBeenCalledWith({ fileName: 'logo.png' }, picture)
  })
})

describe('Members tab', () => {
  test('lists the members, then the invitations', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    const rows = [...document.querySelectorAll('tbody tr')].map((tr) =>
      tr.textContent.replace(/\s+/g, ' ').trim(),
    )
    expect(rows[0]).toContain('admin@example.com')
    expect(rows[0]).toContain(getText('active'))
    expect(rows[1]).toContain('member@example.com')
    expect(rows[2]).toContain('pending@example.com')
    expect(rows[2]).toContain(getText('pendingInvitation'))
    // Nobody removes themselves.
    expect(buttonIn(rowOf('admin@example.com'), getText('remove'))).toBeUndefined()
    expect(buttonIn(rowOf('member@example.com'), getText('remove'))).toBeDefined()
    expect(buttonIn(rowOf('pending@example.com'), getText('copyInviteLink'))).toBeDefined()
  })

  test('on the team plan, gives the seats left, and the enterprise plan behind its paywall', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    expect(document.body.textContent).toContain(getText('seatsLeft', 3, 5))
    await userEvent.setup().click(required(buttonIn(document, getText('upgradeTo', 'Enterprise'))))
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="dialog"]'))
    expect(dialog.textContent).toContain(getText('inviteUserFullFeatureLabel'))
    expect(buttonIn(dialog, getText('contactSales'))).toBeDefined()
  })

  test('removes a member once confirmed', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(rowOf('member@example.com'), getText('remove'))))
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="alertdialog"]'))
    expect(dialog.textContent).toContain(
      getText('deleteUserConfirmation', 'member name', 'member@example.com'),
    )
    expect(dialog.textContent).toContain(getText('deleteUserAlert'))
    expect(dialog.textContent).toContain(getText('thisOperationCannotBeUndone'))
    await user.click(required(buttonIn(dialog, getText('remove'))))
    await flushPromises()
    expect(remote.removeUser).toHaveBeenCalledWith(MEMBER.userId)
  })

  test('cancelling the confirmation removes nobody', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(rowOf('member@example.com'), getText('remove'))))
    await flushPromises()
    await user.keyboard('{Escape}')
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
    if (dialog) await user.click(required(buttonIn(dialog, getText('cancel'))))
    await flushPromises()
    expect(remote.removeUser).not.toHaveBeenCalled()
  })

  test('resends an invitation, and removes one, refreshing the list', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    const user = userEvent.setup()
    await user.click(required(buttonIn(rowOf('pending@example.com'), getText('resend'))))
    await flushPromises()
    expect(remote.resendInvitation).toHaveBeenCalledWith('pending@example.com')
    remote.listInvitations.mockResolvedValue({
      invitations: [],
      availableLicenses: 4,
      maxLicenses: 5,
    })
    await user.click(required(buttonIn(rowOf('pending@example.com'), getText('remove'))))
    await flushPromises()
    expect(remote.deleteInvitation).toHaveBeenCalledWith('pending@example.com')
    expect(document.body.textContent).not.toContain('pending@example.com')
  })

  test('a member who is not an admin sees no actions', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS, makeContext(MEMBER))
    expect(buttonIn(document, getText('inviteMembers'))).toBeUndefined()
    expect(buttonIn(document, getText('remove'))).toBeUndefined()
    expect(buttonIn(document, getText('resend'))).toBeUndefined()
  })

  test('the invitation dialog opens from the keyboard, and Escape returns focus', async () => {
    await mountTab(MEMBERS_SETTINGS_SECTIONS)
    const invite = required(buttonIn(document, getText('inviteMembers')))
    invite.focus()
    const user = userEvent.setup()
    await user.keyboard('{Enter}')
    await flushPromises()
    const dialog = required(document.querySelector<HTMLElement>('[role="dialog"]'))
    expect(dialog.textContent).toContain(getText('inviteEmailFieldLabel'))
    await user.keyboard('{Escape}')
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(invite)
  })
})
