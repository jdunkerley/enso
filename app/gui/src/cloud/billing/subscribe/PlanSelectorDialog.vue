<script setup lang="ts">
/**
 * @file The dialog in which a plan with seats (Team, and Solo while it could be trialled) is
 * bought: the price, the number of seats with a summary of what they cost, and the button that
 * goes on to Stripe.
 *
 * The trigger is the `trigger` slot, and `open` is a `v-model`. The form lives as long as the
 * dialog's component, not only while it is open, so the seats chosen survive closing it. `onSubmit`
 * receives the seats; while its promise is pending the submit button loads, and if it rejects the
 * form shows why.
 */
import Alert from '$/components/Alert/Alert.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import type { Plan, PlanBillingPeriod } from 'enso-common/src/services/Backend'
import type { TextId } from 'enso-common/src/text'
import { computed } from 'vue'
import { MAX_SEATS_BY_PLAN, PRICE_BY_PLAN, PRICE_CURRENCY, TRIAL_DURATION_DAYS } from '../plans'
import PlanFeatures from './PlanFeatures.vue'
import SubscriptionSummary from './SubscriptionSummary.vue'

const PLAN_TO_SEATS_DESCRIPTION_ID = {
  free: 'freePlanSeatsDescription',
  solo: 'soloPlanSeatsDescription',
  team: 'teamPlanSeatsDescription',
  enterprise: 'enterprisePlanSeatsDescription',
} satisfies { [PlanType in Plan]: TextId & `${PlanType}PlanSeatsDescription` }

const {
  plan,
  period,
  planName,
  features,
  title,
  isTrialing = false,
  onSubmit,
} = defineProps<{
  plan: Plan
  period: PlanBillingPeriod
  planName: string
  features: readonly string[]
  title: string
  /** Whether the user is starting a trial rather than buying. */
  isTrialing?: boolean | undefined
  onSubmit: (seats: number) => Promise<void> | void
}>()

const open = defineModel<boolean>('open', { default: false })

const { getText, locale } = useText()

const price = computed(() => PRICE_BY_PLAN[plan])
const maxSeats = computed(() => MAX_SEATS_BY_PLAN[plan])

const form = useForm({
  mode: 'onChange',
  schema: (z) =>
    z.object({
      seats: z
        .number()
        .int()
        .positive()
        .min(1)
        .max(maxSeats.value, { message: getText('wantMoreSeats') }),
    }),
  defaultValues: { seats: 1 },
  onSubmit: ({ seats }) => onSubmit(seats),
})

const seats = computed(() => Number(form.watch('seats')))
const isSeatsInvalid = computed(() => form.formState.errors['seats'] != null)

const formatter = computed(
  () => new Intl.NumberFormat(locale, { style: 'currency', currency: PRICE_CURRENCY }),
)
const priceText = computed(
  () =>
    (isTrialing ? getText('tryFree', TRIAL_DURATION_DAYS) : '') +
    getText('priceTemplate', formatter.value.format(price.value), getText('billedAnnually')),
)
</script>

<template>
  <Dialog
    v-model:open="open"
    size="xxlarge"
    closeButton="floating"
    :aria-label="title"
    padding="large"
  >
    <template v-if="$slots.trigger" #trigger><slot name="trigger" /></template>
    <Heading :level="2" variant="subtitle" weight="medium" disableLineHeightCompensation>
      {{ title }}
    </Heading>

    <Text variant="h1" weight="medium" disableLineHeightCompensation class="mb-2 block">
      {{ priceText }}
    </Text>

    <div class="flex items-center justify-between gap-4">
      <ErrorBoundary>
        <Form :form="form" class="mt-1">
          <!-- Not marked required, as the schema does not require it: no `*`. -->
          <Input
            :readOnly="maxSeats === 1"
            name="seats"
            type="number"
            inputmode="decimal"
            size="small"
            min="1"
            class="mt-1"
            :label="getText('seats')"
            :description="getText(PLAN_TO_SEATS_DESCRIPTION_ID[plan], maxSeats)"
          />

          <SubscriptionSummary
            :plan="plan"
            :seats="seats"
            :period="period"
            :formatter="formatter"
            :isInvalid="isSeatsInvalid"
          />

          <Alert variant="outline" icon="warning">{{ getText('stripeRedirectInfo') }}</Alert>

          <Submit>{{ isTrialing ? getText('startTrial') : getText('subscribeSubmit') }}</Submit>

          <FormError />
        </Form>
      </ErrorBoundary>

      <div>
        <Heading :level="3" variant="body" weight="semibold" class="mb-1">
          {{ getText('upgradeCTA', planName) }}
        </Heading>
        <PlanFeatures :features="features" />
      </div>
    </div>
  </Dialog>
</template>
