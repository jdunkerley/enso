/**
 * @file The query computing a subscription's price, for the plan selector. Framework-free (typed
 * with `@tanstack/query-core`). Its key is the one used before the Vue port (#192).
 */
import type { Plan } from 'enso-common/src/services/Backend'
import { PRICE_BY_PLAN } from './plans'

/** Options for {@link createSubscriptionPriceQuery}. */
export interface SubscriptionPriceQueryOptions {
  readonly plan: Plan
  readonly seats: number
  readonly period: number
}

/** Create a query to fetch the subscription price. */
export function createSubscriptionPriceQuery(options: SubscriptionPriceQueryOptions) {
  return {
    queryKey: ['getPrice', options] as const,
    queryFn: () => {
      const { seats, period, plan } = options

      const price = PRICE_BY_PLAN[plan]

      return Promise.resolve({
        monthlyPrice: price * seats,
        billingPeriod: period,
        totalPrice: price * seats * period,
      })
    },
  }
}
