/**
 * @file The billing modals over the dashboard (#84): the end of a trial, and the warning that a
 * downgraded plan's assets will be deleted, with its rule for when it shows again.
 */
import { useText } from '$/providers/text'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { DAY_MS, HOUR_MS, MINUTE_MS } from '$/utils/time'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { Plan, SubscriptionId, type Backend } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PlanDowngradedModal from '../PlanDowngradedModal.vue'
import TrialEndedModal from '../TrialEndedModal.vue'

const remote = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  cancelSubscription: vi.fn(),
}))

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () => mockBackends({ remoteBackend: remote as unknown as Partial<Backend> }),
  }
})

const { getText } = useText()
const localStorage = LocalStorage.getInstance()

const alertDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent?.trim() === name,
  )!

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.delete('downgradeModal')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TrialEndedModal', () => {
  const subscriptionId = SubscriptionId('subscription-1')

  test('shows the React title, text, alert and buttons', async () => {
    await mountWithProviders(TrialEndedModal, { props: { subscriptionId } })
    const modal = alertDialog()!
    expect(modal.querySelector('h2')!.textContent!.trim()).toBe(getText('trialEnded'))
    expect(modal.textContent).toContain(getText('trialEndedExplanation'))
    expect(modal.textContent).toContain(getText('trialEndedWarning'))
    expect(byTestId('alert-dialog-cancel')!.textContent!.trim()).toBe(getText('downgrade'))
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe(getText('subscribe'))
  })

  test('subscribing opens a Solo checkout in a new tab, and counts as the downgrade modal shown', async () => {
    remote.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.example.com/1' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mountWithProviders(TrialEndedModal, { props: { subscriptionId } })
    await userEvent.setup().click(button(getText('subscribe')))
    await flushPromises()
    expect(remote.createCheckoutSession).toHaveBeenCalledWith({
      price: Plan.solo,
      quantity: 1,
      interval: 1,
    })
    expect(open).toHaveBeenCalledWith('https://checkout.example.com/1', '_blank')
    expect(localStorage.get('downgradeModal')?.lastShownTimestamp).toBeGreaterThan(0)
    await vi.waitFor(() => expect(alertDialog()).toBeNull())
  })

  test('downgrading cancels the subscription, and counts as the downgrade modal shown', async () => {
    remote.cancelSubscription.mockResolvedValue(undefined)
    await mountWithProviders(TrialEndedModal, { props: { subscriptionId } })
    await userEvent.setup().click(button(getText('downgrade')))
    await flushPromises()
    expect(remote.cancelSubscription).toHaveBeenCalledWith(subscriptionId)
    expect(remote.createCheckoutSession).not.toHaveBeenCalled()
    expect(localStorage.get('downgradeModal')?.lastShownTimestamp).toBeGreaterThan(0)
    await vi.waitFor(() => expect(alertDialog()).toBeNull())
  })

  test('a failure stays open with the error', async () => {
    remote.cancelSubscription.mockRejectedValue(new Error('Payment provider unavailable.'))
    await mountWithProviders(TrialEndedModal, { props: { subscriptionId } })
    await userEvent.setup().click(button(getText('downgrade')))
    await flushPromises()
    expect(alertDialog()).not.toBeNull()
    expect(byTestId('form-submit-error')!.textContent!.trim()).toBe('Payment provider unavailable.')
  })
})

describe('PlanDowngradedModal', () => {
  const NOW = new Date('2026-10-03T12:00:00Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
  })

  const mount = (deletionDeadlineTimestamp: number) =>
    mountWithProviders(PlanDowngradedModal, { props: { deletionDeadlineTimestamp } })

  test('shows the time left, with only a Confirm button', async () => {
    await mount(NOW + 10 * DAY_MS + 5 * HOUR_MS + 30 * MINUTE_MS)
    const modal = alertDialog()!
    expect(modal.querySelector('h2')!.textContent!.trim()).toBe(getText('downgradedTitle'))
    expect(modal.textContent).toContain(getText('downgradedExplanation'))
    expect(modal.textContent).toContain(getText('downgradedWarning', 10, 5))
    expect(byTestId('alert-dialog-cancel')).toBeNull()
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe(getText('confirm'))
  })

  test('confirming records it and closes', async () => {
    await mount(NOW + 10 * DAY_MS)
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(button(getText('confirm')))
    await flushPromises()
    expect(localStorage.get('downgradeModal')).toEqual({ lastShownTimestamp: NOW })
    await vi.waitFor(() => expect(alertDialog()).toBeNull())
  })

  test('not after the deadline', async () => {
    await mount(NOW - MINUTE_MS)
    expect(alertDialog()).toBeNull()
  })

  test('not again until five days have passed, while the deadline is further away', async () => {
    localStorage.set('downgradeModal', { lastShownTimestamp: NOW - 4 * DAY_MS })
    await mount(NOW + 30 * DAY_MS)
    expect(alertDialog()).toBeNull()
    // It re-reads the time every minute.
    vi.advanceTimersByTime(DAY_MS + MINUTE_MS)
    await flushPromises()
    expect(alertDialog()).not.toBeNull()
  })

  test('more often as the deadline nears: after the time left to it', async () => {
    localStorage.set('downgradeModal', { lastShownTimestamp: NOW - 2 * DAY_MS })
    await mount(NOW + DAY_MS)
    expect(alertDialog()).not.toBeNull()
  })

  test('but never more than once an hour', async () => {
    localStorage.set('downgradeModal', { lastShownTimestamp: NOW - 30 * MINUTE_MS })
    await mount(NOW + 10 * MINUTE_MS)
    expect(alertDialog()).toBeNull()
  })
})
