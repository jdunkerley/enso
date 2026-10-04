<script setup lang="ts">
/**
 * @file A plan card's button: the Vue port of the React `SubscribeButton`. Its label says what
 * pressing it would do ("Start a 30-day free trial", "Upgrade", "Subscribe", "Current Plan"), and it
 * is disabled for the current plan and for a user who is not the organization's admin.
 *
 * - For a plan below the user's it is replaced by "Contact Sales to downgrade".
 * - For Solo it asks to confirm going to Stripe (an `AlertDialog`), then checks out one seat.
 * - For other plans it opens `PlanSelectorDialog.vue`, where the seats are chosen.
 *
 * `defaultOpen` opens that dialog as the page loads (the subscription page's `plan` parameter), as
 * React's `Dialog.Trigger` `defaultOpen` did, unless the button is disabled.
 */
import { getSalesEmail } from '$/appUtils'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Button from '$/components/Button/Button.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { Plan, type PlanBillingPeriod } from 'enso-common/src/services/Backend'
import { computed, ref } from 'vue'
import { PLAN_TO_UPGRADE_LABEL_ID, TRIAL_DURATION_DAYS } from '../plans'
import PlanSelectorDialog from './PlanSelectorDialog.vue'

const {
  plan,
  period,
  planName,
  features,
  userHasSubscription,
  isCurrent,
  isDowngrade,
  isOrganizationAdmin,
  isDisabled = false,
  defaultOpen = undefined,
  onSubmit,
} = defineProps<{
  plan: Plan
  period: PlanBillingPeriod
  planName: string
  features: readonly string[]
  isOrganizationAdmin: boolean
  userHasSubscription: boolean
  isCurrent: boolean
  isDowngrade: boolean
  isDisabled?: boolean | undefined
  defaultOpen?: boolean | undefined
  onSubmit: (seats: number) => Promise<void> | void
}>()

const { getText } = useText()

const canTrial = computed(
  () => !userHasSubscription && !(plan === Plan.team || plan === Plan.enterprise),
)
const isSolo = computed(() => plan === Plan.solo)

const buttonText = computed(() => {
  if (isDowngrade) return getText('unavailable')
  if (isCurrent) return getText('currentPlan')
  if (userHasSubscription) return getText('upgrade')
  if (canTrial.value) return getText('trialDescription', TRIAL_DURATION_DAYS)
  return getText('subscribe')
})

const variant = computed(() => (isCurrent || isDowngrade ? 'outline' : 'submit'))

const disabled = computed(() => isCurrent || isDowngrade || isDisabled || !isOrganizationAdmin)

// React's `Dialog.Trigger` `defaultOpen`: read once, as the button mounts.
const open = ref(!disabled.value && defaultOpen === true)
</script>

<template>
  <div class="w-full text-center">
    <!-- The line break between the link and "to downgrade" renders as the space React wrote. -->
    <Text v-if="isDowngrade" transform="normal" class="my-0.5">
      <Text transform="none">
        <Button variant="link" :href="getSalesEmail() + `?subject=Downgrade%20our%20plan`">
          {{ getText('contactSales') }}
        </Button>
        {{ getText('downgradeInfo') }}
      </Text>
    </Text>

    <AlertDialog
      v-else-if="isSolo"
      v-model:open="open"
      :title="getText('areYouSure')"
      :confirm="getText('goToStripe')"
      isDestructive
      :canSubmitOffline="false"
      :onConfirm="() => onSubmit(1)"
    >
      <template #trigger>
        <Button
          fullWidth
          :isDisabled="disabled"
          :variant="variant"
          size="medium"
          rounded="full"
          :aria-label="getText(PLAN_TO_UPGRADE_LABEL_ID[plan])"
        >
          {{ buttonText }}
        </Button>
      </template>
      <Text class="relative">{{ getText('stripeRedirectAlert') }}</Text>
    </AlertDialog>

    <PlanSelectorDialog
      v-else
      v-model:open="open"
      :plan="plan"
      :period="period"
      :planName="planName"
      :features="features"
      :onSubmit="onSubmit"
      :isTrialing="canTrial"
      :title="getText('upgradeTo', getText(plan))"
    >
      <template #trigger>
        <Button
          fullWidth
          :isDisabled="disabled"
          :variant="variant"
          size="medium"
          rounded="full"
          :aria-label="getText(PLAN_TO_UPGRADE_LABEL_ID[plan])"
        >
          {{ buttonText }}
        </Button>
      </template>
    </PlanSelectorDialog>
  </div>
</template>
