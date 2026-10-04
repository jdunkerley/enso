<script setup lang="ts">
/**
 * @file The paywall dialog for a feature, opened on the modal stack from a locked context-menu
 * entry, as React's `MenuEntry` opened `PaywallDialog` with `setModal`. It emits `close` once it has
 * closed, so the stack drops it.
 */
import PaywallDialog from '$/cloud/billing/paywall/PaywallDialog.vue'
import type { PaywallFeatureName } from '$/composables/paywall'
import { ref } from 'vue'

const { feature } = defineProps<{ feature: PaywallFeatureName }>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const open = ref(true)
</script>

<template>
  <PaywallDialog v-model:open="open" :feature="feature" @closed="emit('close')" />
</template>
