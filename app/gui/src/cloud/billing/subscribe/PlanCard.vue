<script setup lang="ts">
/**
 * @file A plan's card on the subscription page: its title, subtitle and price, its button, its
 * features and a "Learn More" link.
 *
 * The button is `SubscribeButton.vue` (disabled for the free plan), or "Contact Us" for the
 * enterprise plan. The Team card is raised with a shadow. Buying starts a Stripe checkout
 * (`useCheckout`).
 */
import { getContactPage } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import Icon from '$/components/Icon/Icon.vue'
import Separator from '$/components/Separator/Separator.vue'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { Plan, type PlanBillingPeriod } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { useCheckout } from './checkout'
import SubscribeButton from './SubscribeButton.vue'
import { PLAN_CARD_STYLES } from './variants'

const {
  plan,
  period,
  texts,
  modalOpen,
  userHasSubscription,
  isOrganizationAdmin,
  isCurrent,
  paywallLevel,
  userPaywallLevel,
  class: className,
} = defineProps<{
  plan: Plan
  period: PlanBillingPeriod
  texts: {
    readonly title: string
    readonly subtitle: string
    readonly pricing: string
    readonly features: readonly string[]
  }
  modalOpen: boolean
  userHasSubscription: boolean
  isOrganizationAdmin: boolean
  isCurrent: boolean
  /** The plan's paywall level (`mapPlanOnPaywall`), as a number. */
  paywallLevel: number
  /** The user's plan's paywall level, as a number. */
  userPaywallLevel: number
  class?: string | undefined
}>()

const { getText } = useText()
const checkout = useCheckout()

/** The Team plan is the one raised. */
const styles = computed(() =>
  PLAN_CARD_STYLES({ elevated: plan === Plan.team ? 'xxlarge' : 'none' }),
)

const pricingPage = `${$config.HOST}/pricing`
</script>

<template>
  <div :class="styles.base({ className })">
    <Heading :level="2" disableLineHeightCompensation>{{ texts.title }}</Heading>

    <Text elementType="p" variant="subtitle" weight="medium" disableLineHeightCompensation>
      {{ texts.subtitle }}
    </Text>

    <Text variant="body" weight="bold" disableLineHeightCompensation>{{ texts.pricing }}</Text>

    <div class="my-4">
      <Button
        v-if="plan === Plan.enterprise"
        fullWidth
        variant="outline"
        size="medium"
        rounded="full"
        :href="getContactPage()"
      >
        {{ getText('contactUs') }}
      </Button>
      <SubscribeButton
        v-else
        :onSubmit="(seats) => checkout({ plan, seats, period })"
        :plan="plan"
        :period="period"
        :userHasSubscription="userHasSubscription"
        :isCurrent="isCurrent"
        :isDowngrade="userPaywallLevel > paywallLevel"
        :defaultOpen="modalOpen"
        :features="texts.features"
        :planName="getText(plan)"
        :isOrganizationAdmin="isOrganizationAdmin"
        :isDisabled="plan === Plan.free"
      />
    </div>

    <Separator variant="primary" :class="styles.separator()" orientation="horizontal" />

    <div v-if="texts.features.length > 0" class="mt-4">
      <ul class="flex flex-col gap-2">
        <li v-for="(feature, index) in texts.features" :key="index" class="flex items-center gap-1">
          <span
            class="-mb-[1px] flex h-4 w-4 flex-none place-items-center rounded-full bg-green/30"
          >
            <Icon icon="check" class="text-green" />
          </span>
          <Text variant="body" weight="medium" disableLineHeightCompensation>{{ feature }}</Text>
        </li>
      </ul>
    </div>

    <div v-if="plan !== Plan.free" class="mt-4">
      <Button
        variant="link"
        :href="pricingPage"
        target="_blank"
        icon="open"
        iconPosition="end"
        size="medium"
      >
        {{ getText('learnMore') }}
      </Button>
    </div>
  </div>
</template>
