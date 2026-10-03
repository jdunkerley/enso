<script setup lang="ts">
/** @file A lock icon with the plan a feature needs: the Vue port of the React `PaywallLock`. */
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { getFeatureConfiguration, type PaywallFeatureName } from '$/composables/paywall'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { computed } from 'vue'

const { feature, class: className } = defineProps<{
  feature: PaywallFeatureName
  class?: string | undefined
}>()

const { getText } = useText()
const levelLabel = computed(() => getText(getFeatureConfiguration(feature).level.label))
</script>

<template>
  <div :class="twMerge('flex w-full items-center gap-1', className)">
    <Icon icon="lock" class="-mt-0.5 h-4 w-4" />
    <Text variant="subtitle">{{ getText('paywallAvailabilityLevel', levelLabel) }}</Text>
  </div>
</template>
