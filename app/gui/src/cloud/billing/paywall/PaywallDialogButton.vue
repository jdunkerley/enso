<script setup lang="ts">
/**
 * @file A `PaywallButton.vue` that opens the feature's `PaywallDialog.vue`: the Vue port of the
 * React `PaywallDialogButton`. Attributes (`variant`, `showIcon`, …) go on the button.
 */
import type { PaywallFeatureName } from '$/composables/paywall'
import PaywallButton from './PaywallButton.vue'
import PaywallDialog from './PaywallDialog.vue'

defineOptions({ inheritAttrs: false })

const { feature } = defineProps<{ feature: PaywallFeatureName }>()
</script>

<template>
  <PaywallDialog :feature="feature">
    <template #trigger>
      <PaywallButton :feature="feature" v-bind="$attrs" />
    </template>
  </PaywallDialog>
</template>
