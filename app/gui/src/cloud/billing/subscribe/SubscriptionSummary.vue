<script setup lang="ts">
/**
 * @file The price of the seats being bought, in the plan dialog: the monthly price, the billing
 * period and the subtotal. The Vue port of the React `PlanSelectorDialog`'s `Summary`, with the same
 * query (`createSubscriptionPriceQuery`, keyed by plan, seats and period). It is blurred while the
 * price loads, and while the seats are invalid (when it asks for nothing).
 */
import ErrorDisplay from '$/components/ErrorBoundary/ErrorDisplay.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useQuery } from '@tanstack/vue-query'
import type { Plan } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { createSubscriptionPriceQuery } from '../subscriptionPrice'

const {
  plan,
  seats,
  period,
  formatter,
  isInvalid = false,
} = defineProps<{
  plan: Plan
  seats: number
  period: number
  formatter: Intl.NumberFormat
  isInvalid?: boolean | undefined
}>()

const { getText } = useText()

const priceQuery = useQuery(
  computed(() => ({
    ...createSubscriptionPriceQuery({ plan, seats, period }),
    enabled: !isInvalid,
  })),
)
const data = computed(() => priceQuery.data.value)

/** The text of a billing period. */
const billingPeriod = computed(() => {
  switch (period) {
    case 1: {
      return getText('billingPeriodOneMonth')
    }
    case 12: {
      return getText('billingPeriodOneYear')
    }
    default: {
      return getText('unknownPlaceholder')
    }
  }
})
</script>

<template>
  <ErrorDisplay
    v-if="priceQuery.isError.value"
    :error="priceQuery.error.value"
    :title="getText('asyncHookError')"
    @reset="priceQuery.refetch()"
  />
  <div v-else class="mt-4 flex flex-col">
    <Text variant="subtitle">{{ getText('summary') }}</Text>
    <div
      :class="
        twMerge(
          '-ml-4 table table-auto border-spacing-x-4 transition-[filter] duration-200',
          (priceQuery.isLoading.value || isInvalid) && 'pointer-events-none blur-[4px]',
          priceQuery.isLoading.value && 'animate-pulse duration-1000',
        )
      "
    >
      <div class="table-row">
        <Text class="table-cell w-[0%]" variant="body" nowrap>{{ getText('priceMonthly') }}</Text>
        <Text v-if="data" class="table-cell" variant="body">
          {{ formatter.format(data.monthlyPrice) }}
        </Text>
      </div>
      <div class="table-row">
        <Text class="table-cell w-[0%]" variant="body" nowrap>{{ getText('billingPeriod') }}</Text>
        <Text v-if="data" class="table-cell" variant="body">{{ billingPeriod }}</Text>
      </div>
      <div class="table-row">
        <Text class="table-cell w-[0%]" variant="body" nowrap>{{ getText('subtotalPrice') }}</Text>
        <Text v-if="data" class="table-cell" variant="body">
          {{ formatter.format(data.totalPrice) }}
        </Text>
      </div>
    </div>
  </div>
</template>
