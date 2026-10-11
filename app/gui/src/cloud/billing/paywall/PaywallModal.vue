<script setup lang="ts">
/**
 * @file `PaywallDialog.vue` opened on the modal stack (`$/providers/modals`): it opens as it mounts,
 * and emits `close` once it has closed, so that the stack drops it. It is for menu entries of a
 * feature the user's plan lacks ("Upload To Cloud" on the free plan).
 */
import type { PaywallFeatureName } from '$/composables/paywall'
import { ref } from 'vue'
import PaywallDialog from './PaywallDialog.vue'

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
