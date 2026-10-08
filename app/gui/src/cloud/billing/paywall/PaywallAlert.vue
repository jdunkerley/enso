<script setup lang="ts">
/**
 * @file An alert that a feature is limited on the user's plan, with a link-style upgrade button.
 */
import Alert from '$/components/Alert/Alert.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import type { PaywallFeatureName } from '$/composables/paywall'
import { twJoin } from '$/utils/style/tailwindMerge'
import PaywallUpgradeButton from './PaywallUpgradeButton.vue'

const {
  feature,
  label,
  showUpgradeButton = true,
  class: className,
} = defineProps<{
  feature: PaywallFeatureName
  label: string
  showUpgradeButton?: boolean | undefined
  class?: string | undefined
}>()
</script>

<template>
  <Alert
    variant="outline"
    size="small"
    rounded="xlarge"
    :class="twJoin('border border-primary/20', className)"
  >
    <div class="flex items-center gap-2">
      <Icon icon="lock" class="h-5 w-5 flex-none text-primary" />
      <Text>
        {{ label }}
        <PaywallUpgradeButton
          v-if="showUpgradeButton"
          :feature="feature"
          variant="link"
          size="small"
        />
      </Text>
    </div>
  </Alert>
</template>
