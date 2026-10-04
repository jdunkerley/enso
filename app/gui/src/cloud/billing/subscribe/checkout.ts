/**
 * @file Starting a Stripe checkout for a plan: the React `Card`'s `onSubmit`, unchanged. It logs the
 * checkout, asks the backend for a checkout session (`createCheckoutSession`, with the plan as
 * `price`, the seats as `quantity` and the billing period as `interval`), remembers the plan
 * (`pendingCheckout.ts`), opens the session's URL in a new window (`window.open(url, '_blank')`,
 * which the desktop app hands to the system browser), and goes to the payments success page, which
 * waits for the plan to change.
 *
 * It runs as a vue-query mutation, as React's `useMutationCallback` did, so the mutation cache's
 * global handlers (the unauthorized-session recovery) see it.
 */
import { PAYMENTS_SUCCESS_PATH } from '$/appUtils'
import { useBackends } from '$/providers/backends'
import * as analytics from '$/utils/analytics'
import { useMutation } from '@tanstack/vue-query'
import type { Plan, PlanBillingPeriod } from 'enso-common/src/services/Backend'
import { useRouter } from 'vue-router'
import { setPendingCheckoutTargetPlan } from '../pendingCheckout'

/** What a checkout is for. */
export interface CheckoutParams {
  readonly plan: Plan
  readonly seats: number
  readonly period: PlanBillingPeriod
}

/** Return a function that starts a checkout. Its promise settles once the success page is open. */
export function useCheckout() {
  const { remoteBackend } = useBackends()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: async ({ plan, seats, period }: CheckoutParams) => {
      const planInfo = { price: plan, quantity: seats, interval: period }
      analytics.checkout.before(planInfo)
      const { url } = await remoteBackend.createCheckoutSession(planInfo)
      setPendingCheckoutTargetPlan(plan)
      window.open(url, '_blank')?.focus()
      await router.push(`${PAYMENTS_SUCCESS_PATH}`)
    },
  })

  return (params: CheckoutParams) => mutation.mutateAsync(params)
}
