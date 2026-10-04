/**
 * @file The subscription page and the payments success page (#88): the plan cards and what their
 * buttons say for each plan, the Solo confirmation and the Team dialog (seats, price summary), the
 * checkout they start (the same request, the same window, the same page after), and the wait for the
 * new plan after paying.
 */
import { DASHBOARD_PATH, getContactPage, PAYMENTS_SUCCESS_PATH } from '$/appUtils'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  BackendType,
  Plan,
  type Backend,
  type PaymentsConfig,
  type User,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getPendingCheckoutTargetPlan, setPendingCheckoutTargetPlan } from '../pendingCheckout'
import PaymentsSuccessPage from '../subscribe/PaymentsSuccessPage.vue'
import SubscribePage from '../subscribe/SubscribePage.vue'

const CONFIG: PaymentsConfig = {
  cards: [
    {
      plan: Plan.free,
      period: 12,
      title: 'Free',
      subtitle: 'For everyone',
      pricing: '$0',
      features: ['Local projects'],
    },
    {
      plan: Plan.solo,
      period: 12,
      title: 'Solo',
      subtitle: 'For one',
      pricing: '$75 per month',
      features: ['Cloud storage', 'Scheduling'],
    },
    {
      plan: Plan.team,
      period: 12,
      title: 'Team',
      subtitle: 'For teams',
      pricing: '$150 per user per month',
      features: ['User groups'],
    },
    {
      plan: Plan.enterprise,
      period: 12,
      title: 'Enterprise',
      subtitle: 'For organizations',
      pricing: 'Contact us',
      features: [],
    },
  ],
}

const auth = vi.hoisted(() => ({
  session: null as { user: Partial<User> } | null,
  refetchSession: vi.fn(),
}))
const remote = vi.hoisted(() => ({
  getPaymentsConfig: vi.fn(),
  createCheckoutSession: vi.fn(),
}))
const analytics = vi.hoisted(() => ({ before: vi.fn(), after: vi.fn() }))

vi.mock('$/providers/auth', () => ({ useAuth: () => auth }))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () => mockBackends({ remoteBackend: remote as unknown as Partial<Backend> }),
  }
})
vi.mock('$/utils/analytics', () => ({ checkout: analytics }))
// The info bar and the modal host are not under test.
vi.mock('$/components/InfoBar/InfoBar.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))
vi.mock('$/components/ModalHost/ModalHost.vue', () => ({
  __esModule: true,
  default: { render: () => null },
}))

const { getText } = useText()

const byText = (selector: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent.trim() === text,
  )
const button = (name: string) => byText('button', name)
const buttonByLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const cardOf = (title: string) => byText('h2', title)!.parentElement!
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const dialogButton = (name: string) =>
  [...dialog()!.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent.trim() === name,
  )
const alertDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')

function signIn(plan: Plan, isOrganizationAdmin = true) {
  auth.session = { user: { name: 'user', plan, isOrganizationAdmin } }
}

async function mountSubscribePage(route = '/subscribe') {
  const mounted = await mountWithProviders(SubscribePage, { route })
  await flushPromises()
  return mounted
}

beforeEach(() => {
  vi.resetAllMocks()
  remote.getPaymentsConfig.mockResolvedValue(CONFIG)
  LocalStorage.getInstance().delete('pendingCheckoutTargetPlan')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  // No toast host: drop every toast, as the host does once a closed one has slid out.
  const toasts = useToasts()
  while (toasts.toasts.value.length > 0) {
    toasts.dismiss()
    for (const toast of toasts.toasts.value) toasts.remove(toast.id)
  }
})

describe('SubscribePage', () => {
  test('shows a card for each plan, with its texts, features and links', async () => {
    signIn(Plan.free)
    await mountSubscribePage()
    expect(byText('h1', getText('subscribeTitle'))).toBeDefined()
    const back = byText('a', getText('returnToDashboard'))!
    expect(back.getAttribute('href')).toBe(DASHBOARD_PATH)
    expect(
      [...document.querySelectorAll('h2')].map((heading) => heading.textContent.trim()),
    ).toEqual(['Free', 'Solo', 'Team', 'Enterprise'])
    const solo = cardOf('Solo')
    expect(solo.textContent).toContain('For one')
    expect(solo.textContent).toContain('$75 per month')
    expect([...solo.querySelectorAll('li')].map((item) => item.textContent.trim())).toEqual([
      'Cloud storage',
      'Scheduling',
    ])
    const learnMore = byText('a', getText('learnMore'))!
    expect(learnMore.getAttribute('href')).toBe(`${$config.HOST}/pricing`)
    expect(learnMore.getAttribute('target')).toBe('_blank')
    // Every paid plan has one; the free plan none.
    expect(
      [...document.querySelectorAll('a')].filter(
        (link) => link.textContent.trim() === getText('learnMore'),
      ),
    ).toHaveLength(3)
    expect(cardOf('Enterprise').querySelector('a')!.getAttribute('href')).toBe(getContactPage())
    expect(cardOf('Enterprise').querySelector('a')!.textContent.trim()).toBe(getText('contactUs'))
    // Raised: the Team card only.
    expect(cardOf('Team').className).toContain('shadow-2xl')
    expect(cardOf('Solo').className).not.toContain('shadow-2xl')
  })

  test("labels each plan's button for a user on the free plan", async () => {
    signIn(Plan.free)
    await mountSubscribePage()
    const free = buttonByLabel(getText('freePlanUpgradeLabel'))
    expect(free.textContent.trim()).toBe(getText('currentPlan'))
    expect(free.disabled).toBe(true)
    const solo = buttonByLabel(getText('soloPlanUpgradeLabel'))
    expect(solo.textContent.trim()).toBe(getText('trialDescription', 30))
    expect(solo.disabled).toBe(false)
    const team = buttonByLabel(getText('teamPlanUpgradeLabel'))
    expect(team.textContent.trim()).toBe(getText('subscribe'))
    expect(team.disabled).toBe(false)
  })

  test("labels each plan's button for a user on the solo plan", async () => {
    signIn(Plan.solo)
    await mountSubscribePage()
    // The free plan is below Solo: contact sales to downgrade.
    const free = cardOf('Free')
    expect(free.querySelector('button')).toBeNull()
    const sales = byText('a', getText('contactSales'))!
    expect(sales.getAttribute('href')).toBe(
      'mailto:contact@enso.org?subject=Downgrade%20our%20plan',
    )
    expect(sales.parentElement!.textContent).toBe(
      `${getText('contactSales')} ${getText('downgradeInfo')}`,
    )
    const solo = buttonByLabel(getText('soloPlanUpgradeLabel'))
    expect(solo.textContent.trim()).toBe(getText('currentPlan'))
    expect(solo.disabled).toBe(true)
    const team = buttonByLabel(getText('teamPlanUpgradeLabel'))
    expect(team.textContent.trim()).toBe(getText('upgrade'))
    expect(team.disabled).toBe(false)
  })

  test('disables the buttons for a user who is not the organization admin', async () => {
    signIn(Plan.free, false)
    await mountSubscribePage()
    expect(buttonByLabel(getText('soloPlanUpgradeLabel')).disabled).toBe(true)
    expect(buttonByLabel(getText('teamPlanUpgradeLabel')).disabled).toBe(true)
  })

  test('Solo asks to confirm, then checks out one seat in Stripe', async () => {
    signIn(Plan.free)
    const focus = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window)
    remote.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/1' })
    const { router } = await mountSubscribePage()
    const user = userEvent.setup()
    await user.click(buttonByLabel(getText('soloPlanUpgradeLabel')))
    await flushPromises()
    const confirm = alertDialog()!
    expect(confirm.querySelector('h2')!.textContent.trim()).toBe(getText('areYouSure'))
    expect(confirm.textContent).toContain(getText('stripeRedirectAlert'))
    await user.click(button(getText('goToStripe'))!)
    await flushPromises()
    expect(remote.createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(remote.createCheckoutSession).toHaveBeenCalledWith({
      price: Plan.solo,
      quantity: 1,
      interval: 12,
    })
    expect(analytics.before).toHaveBeenCalledWith({ price: Plan.solo, quantity: 1, interval: 12 })
    expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/1', '_blank')
    expect(focus).toHaveBeenCalled()
    expect(getPendingCheckoutTargetPlan()).toBe(Plan.solo)
    expect(router.currentRoute.value.path).toBe(PAYMENTS_SUCCESS_PATH)
  })

  test('Team opens the plan dialog, prices the seats, and checks them out', async () => {
    signIn(Plan.free)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    remote.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/2' })
    const { router } = await mountSubscribePage()
    const user = userEvent.setup()
    await user.click(buttonByLabel(getText('teamPlanUpgradeLabel')))
    await flushPromises()
    const planDialog = dialog()!
    expect(planDialog.getAttribute('aria-label')).toBe(getText('upgradeTo', getText(Plan.team)))
    expect(planDialog.textContent).toContain(
      getText('priceTemplate', '$150.00', getText('billedAnnually')),
    )
    expect(planDialog.textContent).toContain(getText('teamPlanSeatsDescription', 10))
    expect(planDialog.textContent).toContain(getText('upgradeCTA', getText(Plan.team)))
    expect(planDialog.textContent).toContain('User groups')
    const seats = planDialog.querySelector<HTMLInputElement>('input[name="seats"]')!
    expect(seats.value).toBe('1')
    await vi.waitFor(() => expect(planDialog.textContent).toContain('$1,800.00'))
    await user.clear(seats)
    await user.type(seats, '3')
    await flushPromises()
    await vi.waitFor(() => expect(planDialog.textContent).toContain('$450.00'))
    expect(planDialog.textContent).toContain('$5,400.00')
    expect(planDialog.textContent).toContain(getText('billingPeriodOneYear'))
    // More seats than the plan allows.
    await user.clear(seats)
    await user.type(seats, '11')
    await flushPromises()
    expect(planDialog.textContent).toContain(getText('wantMoreSeats'))
    expect(planDialog.querySelector('.blur-\\[4px\\]')).not.toBeNull()
    await user.clear(seats)
    await user.type(seats, '3')
    await flushPromises()
    await user.click(dialogButton(getText('subscribeSubmit'))!)
    await flushPromises()
    expect(remote.createCheckoutSession).toHaveBeenCalledTimes(1)
    expect(remote.createCheckoutSession).toHaveBeenCalledWith({
      price: Plan.team,
      quantity: 3,
      interval: 12,
    })
    expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/c/2', '_blank')
    expect(getPendingCheckoutTargetPlan()).toBe(Plan.team)
    expect(router.currentRoute.value.path).toBe(PAYMENTS_SUCCESS_PATH)
  })

  test('a failed checkout stays in the dialog and says why', async () => {
    signIn(Plan.free)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    remote.createCheckoutSession.mockRejectedValue(new Error('Stripe is down.'))
    const { router } = await mountSubscribePage()
    const user = userEvent.setup()
    await user.click(buttonByLabel(getText('teamPlanUpgradeLabel')))
    await flushPromises()
    await user.click(dialogButton(getText('subscribeSubmit'))!)
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    expect(getPendingCheckoutTargetPlan()).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/subscribe')
    expect(document.querySelector('[data-testid="form-submit-error"]')?.textContent).toContain(
      'Stripe is down.',
    )
  })

  test("the `plan` parameter opens that plan's dialog", async () => {
    signIn(Plan.free)
    await mountSubscribePage('/subscribe?plan=team')
    expect(dialog()?.getAttribute('aria-label')).toBe(getText('upgradeTo', getText(Plan.team)))
  })

  test('the `plan` parameter opens nothing for the current plan', async () => {
    signIn(Plan.solo)
    await mountSubscribePage('/subscribe?plan=solo')
    expect(alertDialog()).toBeNull()
    expect(dialog()).toBeNull()
  })
})

describe('PaymentsSuccessPage', () => {
  test('without a pending checkout, returns to the dashboard', async () => {
    const { router } = await mountWithProviders(PaymentsSuccessPage, { route: '/payments/success' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(DASHBOARD_PATH)
    expect(auth.refetchSession).not.toHaveBeenCalled()
  })

  test('waits for the new plan, then says so and returns to the dashboard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setPendingCheckoutTargetPlan(Plan.team)
    auth.refetchSession
      .mockResolvedValueOnce({ data: { user: { plan: Plan.free } } })
      .mockResolvedValue({ data: { user: { plan: Plan.team } } })
    const toasts = useToasts()
    const { router, queryClient } = await mountWithProviders(PaymentsSuccessPage, {
      route: '/payments/success',
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await flushPromises()
    expect(document.body.textContent).toContain(getText('cancel'))
    expect(toasts.toasts.value.map((toast) => [toast.content, toast.isLoading])).toEqual([
      [getText('payments.pending'), true],
    ])
    expect(router.currentRoute.value.path).toBe(PAYMENTS_SUCCESS_PATH)
    await vi.advanceTimersByTimeAsync(3_000)
    await flushPromises()
    expect(auth.refetchSession).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe(DASHBOARD_PATH)
    expect(getPendingCheckoutTargetPlan()).toBeUndefined()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [BackendType.remote, 'getOrganization'] })
    expect(analytics.after).toHaveBeenCalled()
    expect(
      toasts.toasts.value.filter((toast) => toast.isIn).map((toast) => [toast.content, toast.type]),
    ).toEqual([[getText('payments.success'), 'success']])
  })

  test('gives up after a minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setPendingCheckoutTargetPlan(Plan.team)
    auth.refetchSession.mockResolvedValue({ data: { user: { plan: Plan.free } } })
    const toasts = useToasts()
    const { router } = await mountWithProviders(PaymentsSuccessPage, { route: '/payments/success' })
    await flushPromises()
    for (let i = 0; i < 21; i++) {
      await vi.advanceTimersByTimeAsync(3_000)
      await flushPromises()
    }
    expect(router.currentRoute.value.path).toBe(DASHBOARD_PATH)
    expect(getPendingCheckoutTargetPlan()).toBeUndefined()
    expect(
      toasts.toasts.value.filter((toast) => toast.isIn).map((toast) => [toast.content, toast.type]),
    ).toEqual([[getText('payments.timeout'), 'error']])
  })

  test('Cancel forgets the checkout and returns to the dashboard', async () => {
    setPendingCheckoutTargetPlan(Plan.team)
    auth.refetchSession.mockResolvedValue({ data: { user: { plan: Plan.free } } })
    const { router } = await mountWithProviders(PaymentsSuccessPage, { route: '/payments/success' })
    await userEvent.setup().click(button(getText('cancel'))!)
    await flushPromises()
    expect(getPendingCheckoutTargetPlan()).toBeUndefined()
    expect(router.currentRoute.value.path).toBe(DASHBOARD_PATH)
  })
})
