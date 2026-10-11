<script setup lang="ts">
/**
 * @file A screen in place of a feature the user's plan lacks: the plan it needs, what it brings,
 * and the upgrade button.
 */
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { getFeatureConfiguration, type PaywallFeatureName } from '$/composables/paywall'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { computed } from 'vue'
import PaywallBulletPoints from './PaywallBulletPoints.vue'
import PaywallLock from './PaywallLock.vue'
import PaywallUpgradeButton from './PaywallUpgradeButton.vue'

const { feature, class: className } = defineProps<{
  feature: PaywallFeatureName
  class?: string | undefined
}>()

const { getText } = useText()
const configuration = computed(() => getFeatureConfiguration(feature))
</script>

<template>
  <div :class="twMerge('flex flex-col items-start', className)">
    <PaywallLock :feature="feature" />
    <Heading :level="2">{{ getText('paywallScreenTitle') }}</Heading>
    <Text balance variant="subtitle" class="mt-1 max-w-[720px]">
      {{ getText(configuration.descriptionTextId) }}
    </Text>
    <PaywallBulletPoints :bulletPointsTextId="configuration.bulletPointsTextId" class="my-3" />
    <PaywallUpgradeButton :feature="feature" class="mt-0.5 min-w-36" />
  </div>
</template>
