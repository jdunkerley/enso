<script setup lang="ts">
/**
 * @file The button that leads to the plan a feature needs: the subscription page or, for the
 * enterprise plan, the contact page. (The user bar's "Upgrade" is `../UpgradeButton.vue`.)
 *
 * Its label is the default slot, or "Upgrade to <plan>" ("Contact Sales" for the enterprise plan).
 * Other attributes (`class`, …) go on the `Button.vue`.
 */
import { getContactPage, getUpgradeURL } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import { getFeatureConfiguration, type PaywallFeatureName } from '$/composables/paywall'
import { PAYWALL_LEVELS, type PaywallLevelName } from '$/composables/paywall/FeaturesConfiguration'
import { useText } from '$/providers/text'
import { computed } from 'vue'

type ButtonProps = InstanceType<typeof Button>['$props']

const {
  feature,
  variant,
  size = 'medium',
  rounded = 'xlarge',
  href,
} = defineProps<{
  feature: PaywallFeatureName
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  rounded?: ButtonProps['rounded']
  href?: string | undefined
}>()

const VARIANT_BY_LEVEL: Record<PaywallLevelName, ButtonProps['variant']> = {
  free: 'primary',
  enterprise: 'primary',
  solo: 'accent',
  team: 'submit',
}

const { getText } = useText()
const level = computed(() => getFeatureConfiguration(feature).level)
const isEnterprise = computed(() => level.value === PAYWALL_LEVELS.enterprise)
</script>

<template>
  <Button
    :variant="variant ?? VARIANT_BY_LEVEL[level.name]"
    :size="size"
    :rounded="rounded"
    :href="isEnterprise ? getContactPage() : (href ?? getUpgradeURL(level.name))"
  >
    <slot>
      {{ isEnterprise ? getText('contactSales') : getText('upgradeTo', getText(level.label)) }}
    </slot>
  </Button>
</template>
