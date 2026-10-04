<script setup lang="ts">
/**
 * @file The plans on offer, as a row of cards: the Vue port of the React `PlanSelector`. The cards
 * come from the backend's payments configuration (`getPaymentsConfig`); the setup waits for it, as
 * React's suspense query did, so an enclosing `SuspenseLoader` shows the loader meanwhile.
 */
import { mapPlanOnPaywall } from '$/composables/paywall/FeaturesConfiguration'
import { useBackends } from '$/providers/backends'
import { useQuery } from '@tanstack/vue-query'
import { Plan } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { paymentsConfigQueryOptions } from '../queries'
import PlanCard from './PlanCard.vue'
import { PLAN_SELECTOR_STYLES } from './variants'

const {
  plan = null,
  userPlan,
  showFreePlan,
  isOrganizationAdmin,
} = defineProps<{
  userPlan: Plan
  showFreePlan: boolean
  isOrganizationAdmin: boolean
  /** The plan whose dialog opens at once. */
  plan?: Plan | null | undefined
}>()

const { remoteBackend } = useBackends()

const configQuery = useQuery({ ...paymentsConfigQueryOptions(remoteBackend), throwOnError: true })
await configQuery.suspense()
const cards = computed(() => configQuery.data.value?.cards ?? [])

const classes = computed(() => PLAN_SELECTOR_STYLES({ showFreePlan }))
</script>

<template>
  <div :class="classes.base()">
    <div :class="classes.grid()">
      <PlanCard
        v-for="card in cards"
        :key="`${card.plan}/${card.period}`"
        :plan="card.plan"
        :period="card.period"
        :texts="card"
        :modalOpen="card.plan === plan"
        :userHasSubscription="userPlan !== Plan.free"
        :isOrganizationAdmin="isOrganizationAdmin"
        :isCurrent="card.plan === userPlan"
        :paywallLevel="mapPlanOnPaywall(card.plan).valueOf()"
        :userPaywallLevel="mapPlanOnPaywall(userPlan).valueOf()"
        :class="classes.card()"
      />
    </div>
  </div>
</template>
