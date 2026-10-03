/**
 * @file The "Invite" dialog (`InviteUsersModal.vue`), opened from the user bar's button: the form's
 * validation (empty, invalid addresses, more addresses than seats), the paywall alert of a plan with
 * limited invitations, sending the invitations, the success step (its title, the link, "Go to Members
 * Page" and Close), and starting afresh when reopened.
 */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { EmailAddress, OrganizationId, Plan, type User } from 'enso-common/src/services/Backend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import InviteUsersButton from '../InviteUsersButton.vue'

const USER = {
  name: 'admin',
  email: EmailAddress('admin@example.com'),
  organizationId: OrganizationId('organization-1'),
  plan: Plan.team,
  isOrganizationAdmin: true,
} as User

const auth = vi.hoisted(() => ({ session: null as unknown }))
const remote = vi.hoisted(() => ({ listInvitations: vi.fn(), inviteUser: vi.fn() }))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ remoteBackend: remote }) }
})

const { getText } = useText()

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (container: ParentNode, name: string) =>
  [...container.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent.trim() === name,
  )
const required = <T>(value: T | null | undefined, what = 'element'): T => {
  if (value == null) throw new Error(`Missing ${what}.`)
  return value
}

async function openDialog(plan: Plan = Plan.team) {
  auth.session = { user: { ...USER, plan } }
  const mounted = await mountWithProviders(InviteUsersButton, {
    routes: [{ name: 'settings', path: '/settings', component: { render: () => null } }],
  })
  const user = userEvent.setup()
  await user.click(required(button(document, getText('invite'))))
  await flushPromises()
  return { ...mounted, user, input: required(dialog()?.querySelector('input')) }
}

beforeEach(() => {
  vi.resetAllMocks()
  remote.listInvitations.mockResolvedValue({
    invitations: [],
    availableLicenses: 3,
    maxLicenses: 5,
  })
  remote.inviteUser.mockResolvedValue(undefined)
})

describe('InviteUsersModal', () => {
  test('opens titled "Invite", with the form', async () => {
    await openDialog()
    const content = required(dialog())
    expect(content.querySelector('h1, h2')?.textContent.trim()).toBe(getText('invite'))
    expect(content.textContent).toContain(getText('inviteEmailFieldLabel'))
    expect(content.textContent).toContain(getText('inviteEmailFieldDescription'))
    expect(content.querySelector('input')?.placeholder).toBe(getText('inviteEmailFieldPlaceholder'))
    expect(button(content, getText('inviteSubmit'))).toBeDefined()
  })

  test('requires an address, and refuses invalid ones', async () => {
    const { user, input } = await openDialog()
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    expect(dialog()?.textContent).toContain(getText('emailIsRequired'))
    await user.type(input, 'not-an-email, new@example.org')
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    expect(dialog()?.textContent).toContain(getText('emailIsInvalid'))
    expect(remote.inviteUser).not.toHaveBeenCalled()
  })

  test('refuses more addresses than seats left', async () => {
    const { user, input } = await openDialog()
    await user.type(input, 'a@example.org b@example.org c@example.org d@example.org')
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    expect(dialog()?.textContent).toContain(getText('emailIsInvalid'))
    expect(remote.inviteUser).not.toHaveBeenCalled()
  })

  test('on the team plan, says how many seats are left', async () => {
    await openDialog()
    expect(dialog()?.textContent).toContain(getText('inviteFormSeatsLeft', 3))
    expect(button(required(dialog()), getText('upgradeTo', 'Enterprise'))).toBeUndefined()
    expect(dialog()?.textContent).toContain(getText('contactSales'))
  })

  test('on the enterprise plan, shows no seat limit', async () => {
    await openDialog(Plan.enterprise)
    expect(dialog()?.textContent).not.toContain(getText('inviteFormSeatsLeft', 3))
  })

  test('with no seats left, "Send invites" is disabled', async () => {
    remote.listInvitations.mockResolvedValue({
      invitations: [],
      availableLicenses: 0,
      maxLicenses: 5,
    })
    await openDialog()
    expect(
      required(button(required(dialog()), getText('inviteSubmit'))).hasAttribute('disabled'),
    ).toBe(true)
  })

  test('invites each address once, then shows the link', async () => {
    const { user, input } = await openDialog()
    await user.type(input, 'one@example.org; two@example.org one@example.org')
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    expect(remote.inviteUser.mock.calls).toEqual([
      [{ userEmail: 'one@example.org' }],
      [{ userEmail: 'two@example.org' }],
    ])
    const content = required(dialog())
    expect(content.textContent).toContain(
      getText('inviteSuccess', 'one@example.org and two@example.org'),
    )
    expect(content.textContent).toContain(getText('inviteUserLinkCopyDescription'))
    expect(content.textContent).toContain('enso://auth/registration?organization_id=organization-1')
  })

  test('"Go to Members Page" closes the dialog and opens the Members tab', async () => {
    const { user, input, router } = await openDialog()
    await user.type(input, 'one@example.org')
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    await user.click(required(button(required(dialog()), getText('goToMembersPage'))))
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.query['cloud-ide_SettingsTab']).toBe('"members"')
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })

  test('Close closes it, and it opens again at the form', async () => {
    const { user, input } = await openDialog()
    await user.type(input, 'one@example.org')
    await user.click(required(button(required(dialog()), getText('inviteSubmit'))))
    await flushPromises()
    await user.click(required(button(required(dialog()), getText('closeModalShortcut'))))
    await vi.waitFor(() => expect(dialog()).toBeNull())
    await user.click(required(button(document, getText('invite'))))
    await flushPromises()
    expect(button(required(dialog()), getText('inviteSubmit'))).toBeDefined()
  })
})
