/**
 * @file The Billing & Plans settings tab, with the section the cloud contributes
 * (`$/cloud/billing`): "Open Billing Page" opens the Stripe customer portal in a new window, and a
 * failure shows an error toast.
 */
import { BILLING_AND_PLANS_SETTINGS_SECTIONS } from '$/cloud/billing/settingsSections'
import type { SettingsContext } from '$/configurations/settings'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { EmailAddress, Plan, UserId, type User } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { markRaw, ref } from 'vue'
import SettingsTab from '../SettingsTab.vue'
import { required } from './dom'

const ADMIN = {
  userId: UserId('user-admin'),
  name: 'admin name',
  email: EmailAddress('admin@example.com'),
  plan: Plan.team,
  isOrganizationAdmin: true,
} as unknown as User

const remote = vi.hoisted(() => ({ createCustomerPortalSession: vi.fn() }))

const { getText } = useText()

function makeContext() {
  return ref<SettingsContext>({
    accessToken: '',
    user: ADMIN,
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

async function mountTab() {
  return mountWithProviders(SettingsTab, {
    props: { sections: markRaw([...BILLING_AND_PLANS_SETTINGS_SECTIONS]) },
    stores: { settingsContext: makeContext() },
  })
}

const openBillingPage = () =>
  required(
    [...document.querySelectorAll<HTMLElement>('button')].find(
      (button) => button.textContent.trim() === getText('openBillingPage'),
    ),
  )

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  // No toast host: drop every toast, as the host does once a closed one has slid out.
  const toasts = useToasts()
  while (toasts.toasts.value.length > 0) {
    toasts.dismiss()
    for (const toast of toasts.toasts.value) toasts.remove(toast.id)
  }
})

describe('Billing & Plans tab', () => {
  test("shows React's heading and button", async () => {
    await mountTab()
    expect(
      [...document.querySelectorAll('h2')].map((heading) => heading.textContent.trim()),
    ).toEqual([getText('billingAndPlansSettingsSection')])
    const button = openBillingPage()
    expect(button.className).toContain('self-start')
    expect(button.parentElement?.className).toContain('grow-0')
  })

  test('opens the customer portal in a new window', async () => {
    const focus = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window)
    remote.createCustomerPortalSession.mockResolvedValue('https://billing.example.com/portal')
    await mountTab()
    await userEvent.setup().click(openBillingPage())
    await flushPromises()
    expect(remote.createCustomerPortalSession).toHaveBeenCalledWith()
    expect(open).toHaveBeenCalledWith('https://billing.example.com/portal', '_blank')
    expect(focus).toHaveBeenCalled()
  })

  test('opens nothing when the backend gives no URL', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    remote.createCustomerPortalSession.mockResolvedValue(null)
    await mountTab()
    await userEvent.setup().click(openBillingPage())
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
  })

  test('a failure shows an error toast and is logged', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    remote.createCustomerPortalSession.mockRejectedValue(new Error('No portal.'))
    // The rejection reaches the button, as React's did.
    const onUnhandled = vi.fn()
    process.on('unhandledRejection', onUnhandled)
    try {
      await mountTab()
      await userEvent.setup().click(openBillingPage())
      await flushPromises()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(open).not.toHaveBeenCalled()
    const message = `${getText('arbitraryErrorTitle')}: No portal.`
    expect(useToasts().toasts.value.map((toast) => [toast.content, toast.type])).toEqual([
      [message, 'error'],
    ])
    expect(error).toHaveBeenCalledWith(message)
  })
})
