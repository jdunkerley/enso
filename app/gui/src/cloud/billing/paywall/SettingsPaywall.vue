<script setup lang="ts">
/**
 * @file The paywall screen the settings page shows in place of a tab whose feature the user's plan
 * lacks, contributed by `registerBillingSettings`.
 */
import type { PaywallFeatureName } from '$/composables/paywall'
import PaywallScreen from './PaywallScreen.vue'

const { feature } = defineProps<{ feature: PaywallFeatureName }>()
</script>

<template>
  <div class="mt-1">
    <PaywallScreen :feature="feature" />
  </div>
</template>
