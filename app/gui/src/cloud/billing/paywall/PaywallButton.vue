<script setup lang="ts">
/**
 * @file A button showing that a feature is behind a paywall, with a lock icon (unless `showIcon` is
 * `false`) and the plan in its tooltip. Its label is the default slot, or "Upgrade to <plan>".
 * Other attributes go on the `Button.vue`.
 */
import Button from '$/components/Button/Button.vue'
import { getFeatureConfiguration, type PaywallFeatureName } from '$/composables/paywall'
import { useText } from '$/providers/text'
import { computed } from 'vue'

type ButtonProps = InstanceType<typeof Button>['$props']

const {
  feature,
  iconOnly = false,
  showIcon = true,
  variant = 'primary',
  size = 'medium',
} = defineProps<{
  feature: PaywallFeatureName
  iconOnly?: boolean | undefined
  showIcon?: boolean | undefined
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}>()

const { getText } = useText()
const levelLabel = computed(() => getText(getFeatureConfiguration(feature).level.label))
</script>

<template>
  <Button
    :variant="variant"
    :size="size"
    :icon="showIcon ? 'lock' : undefined"
    iconPosition="end"
    :tooltip="getText('paywallScreenDescription', levelLabel)"
  >
    <template v-if="!iconOnly" #default>
      <slot>{{ getText('upgradeTo', levelLabel) }}</slot>
    </template>
  </Button>
</template>
