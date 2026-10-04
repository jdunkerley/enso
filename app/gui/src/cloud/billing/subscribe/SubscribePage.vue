<script setup lang="ts">
/**
 * @file The subscription page (`/subscribe`), where the user's plan is changed: a link back to the
 * dashboard, and the plans on offer (`PlanSelector.vue`). The Vue port of the React `Subscribe`.
 *
 * The `plan` query parameter (`getUpgradeURL`, from the paywall's upgrade buttons) names a plan whose
 * dialog opens at once. Choosing a plan goes on to Stripe and then to the payments success page.
 */
import { DASHBOARD_PATH } from '$/appUtils'
import { queryParam } from '$/cloud/auth/queryParam'
import Button from '$/components/Button/Button.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import Heading from '$/components/Text/Heading.vue'
import { useAuth } from '$/providers/auth'
import { useText } from '$/providers/text'
import { isPlan } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PlanSelector from './PlanSelector.vue'

const { getText } = useText()
const auth = useAuth()
const route = useRoute()

const user = computed(() => {
  const session = auth.session
  if (session == null) throw new Error('The subscription page needs a signed-in user.')
  return session.user
})

const chosenPlan = computed(() => {
  const maybePlan = queryParam(route, 'plan')
  return isPlan(maybePlan) ? maybePlan : null
})
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-y-auto bg-hover-bg">
    <div
      class="mx-auto mt-16 flex w-full min-w-96 max-w-[1400px] flex-col items-start justify-center p-12"
    >
      <div class="flex flex-col items-start">
        <Button
          variant="icon"
          size="medium"
          icon="arrow_circle_left"
          :href="DASHBOARD_PATH"
          class="-ml-2"
        >
          {{ getText('returnToDashboard') }}
        </Button>

        <Heading :level="1" variant="custom" class="mb-5 self-start text-start text-4xl">
          {{ getText('subscribeTitle') }}
        </Heading>
      </div>

      <SuspenseLoader>
        <PlanSelector
          :plan="chosenPlan"
          :showFreePlan="false"
          :userPlan="user.plan"
          :isOrganizationAdmin="user.isOrganizationAdmin"
        />
      </SuspenseLoader>
    </div>
  </div>
</template>
