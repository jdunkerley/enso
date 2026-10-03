/**
 * @file The organization modals over the dashboard (#84): setting up the organization's name, and
 * accepting or declining an invitation. Each does what its React original did, and fails as it did.
 */
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  EmailAddress,
  OrganizationId,
  type Backend,
  type Invitation,
} from 'enso-common/src/services/Backend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import AcceptInvitationModal from '../AcceptInvitationModal.vue'
import SetupOrganizationModal from '../SetupOrganizationModal.vue'

const remote = vi.hoisted(() => ({
  updateOrganization: vi.fn(),
  createUserGroup: vi.fn(),
  updateUser: vi.fn(),
  deleteInvitation: vi.fn(),
}))

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () => mockBackends({ remoteBackend: remote as unknown as Partial<Backend> }),
  }
})

const { getText } = useText()

const dialog = (role = 'dialog') => document.querySelector<HTMLElement>(`[role="${role}"]`)
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent?.trim() === name,
  )!
const toastTexts = () => useToasts().toasts.value.map((toast) => [toast.type, toast.content])

beforeEach(() => {
  vi.resetAllMocks()
  const toasts = useToasts()
  for (const toast of [...toasts.toasts.value]) toasts.remove(toast.id)
})

describe('SetupOrganizationModal', () => {
  const input = () => dialog()!.querySelector<HTMLInputElement>('input[name="name"]')!

  test('asks for the name, with the React title, text, label and description', async () => {
    await mountWithProviders(SetupOrganizationModal)
    const modal = dialog()!
    expect(modal.querySelector('h2')!.textContent!.trim()).toBe(getText('setupOrganization'))
    expect(modal.textContent).toContain(getText('setOrganizationNameDescription'))
    expect(modal.textContent).toContain(getText('organizationNameSettingsInput'))
    expect(modal.textContent).toContain(getText('organizationNameSettingsInputDescription', 64))
    expect(input().getAttribute('autocomplete')).toBe('off')
    expect(input().getAttribute('inputmode')).toBe('text')
    await vi.waitFor(() => expect(document.activeElement).toBe(input()))
  })

  test('a name that is too short is refused', async () => {
    await mountWithProviders(SetupOrganizationModal)
    const user = userEvent.setup()
    await user.type(input(), 'ab')
    await user.click(button(getText('submit')))
    await flushPromises()
    expect(dialog()!.textContent).toContain(getText('organizationNameMinLengthError'))
    expect(remote.updateOrganization).not.toHaveBeenCalled()
  })

  test('names the organization, then creates its default user group of that name', async () => {
    const order: string[] = []
    remote.updateOrganization.mockImplementation(async () => void order.push('organization'))
    remote.createUserGroup.mockImplementation(async () => void order.push('group'))
    await mountWithProviders(SetupOrganizationModal)
    const user = userEvent.setup()
    await user.type(input(), 'Acme')
    await user.click(button(getText('submit')))
    await flushPromises()
    expect(remote.updateOrganization).toHaveBeenCalledWith({ name: 'Acme' })
    expect(remote.createUserGroup).toHaveBeenCalledWith({ name: 'Acme' })
    expect(order).toEqual(['organization', 'group'])
  })

  test('a failure shows as the form error, and creates no group', async () => {
    remote.updateOrganization.mockRejectedValue(new Error('Name taken.'))
    await mountWithProviders(SetupOrganizationModal)
    const user = userEvent.setup()
    await user.type(input(), 'Acme')
    await user.click(button(getText('submit')))
    await flushPromises()
    expect(document.querySelector('[data-testid="form-submit-error"]')!.textContent!.trim()).toBe(
      'Name taken.',
    )
    expect(remote.createUserGroup).not.toHaveBeenCalled()
  })

  test('can be dismissed with Escape, as React allowed', async () => {
    await mountWithProviders(SetupOrganizationModal)
    await userEvent.setup().keyboard('{Escape}')
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })
})

describe('AcceptInvitationModal', () => {
  const invitation = {
    organizationId: OrganizationId('organization-acme'),
    organizationName: 'Acme',
    userEmail: EmailAddress('user@example.com'),
  } as Invitation

  test('shows the invitation, with the React title, text, alert and buttons', async () => {
    await mountWithProviders(AcceptInvitationModal, { props: { invitation } })
    const modal = dialog('alertdialog')!
    expect(modal.querySelector('h2')!.textContent!.trim()).toBe(getText('pendingInvitationInfo'))
    expect(modal.textContent).toContain(getText('invitationText', 'Acme'))
    expect(modal.textContent).toContain(getText('invitationAlert'))
    expect(button(getText('decline'))).toBeDefined()
    expect(document.activeElement).toBe(button(getText('accept')))
  })

  test('accepting joins the organization, welcomes the user and closes', async () => {
    remote.updateUser.mockResolvedValue(undefined)
    await mountWithProviders(AcceptInvitationModal, { props: { invitation } })
    await userEvent.setup().click(button(getText('accept')))
    await flushPromises()
    expect(remote.updateUser).toHaveBeenCalledWith({ organizationId: invitation.organizationId })
    expect(toastTexts()).toEqual([['success', getText('welcomeToTeam', 'Acme')]])
    await vi.waitFor(() => expect(dialog('alertdialog')).toBeNull())
  })

  test('a failed acceptance toasts the error and stays open with it', async () => {
    remote.updateUser.mockRejectedValue(new Error('No such organization.'))
    await mountWithProviders(AcceptInvitationModal, { props: { invitation } })
    await userEvent.setup().click(button(getText('accept')))
    await flushPromises()
    expect(toastTexts()).toEqual([['error', getText('invitationError')]])
    expect(dialog('alertdialog')).not.toBeNull()
    expect(document.querySelector('[data-testid="form-submit-error"]')!.textContent!.trim()).toBe(
      'No such organization.',
    )
  })

  test('declining deletes the invitation and closes', async () => {
    remote.deleteInvitation.mockResolvedValue(undefined)
    await mountWithProviders(AcceptInvitationModal, { props: { invitation } })
    await userEvent.setup().click(button(getText('decline')))
    await flushPromises()
    expect(remote.deleteInvitation).toHaveBeenCalledWith('user@example.com')
    expect(remote.updateUser).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(dialog('alertdialog')).toBeNull())
  })

  test('cannot be dismissed with Escape: the user must choose', async () => {
    await mountWithProviders(AcceptInvitationModal, { props: { invitation } })
    await userEvent.setup().keyboard('{Escape}')
    await flushPromises()
    expect(dialog('alertdialog')).not.toBeNull()
  })
})
