<script setup lang="ts">
/**
 * @file Renders the app's modal stack (`$/providers/modals`), bottom to top, each modal in its own
 * `ErrorBoundary`. A modal leaves the stack when it emits `close`.
 *
 * The host adds no element of its own and does not teleport: each modal portals its own overlay
 * into `#enso-portal-root` (through its `Dialog`), so their DOM is the same wherever the host is
 * mounted.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import { useModals, type ModalsStore } from '$/providers/modals'

const { store = useModals() } = defineProps<{
  /** The store to render; the app's global one by default. */
  store?: ModalsStore
}>()
</script>

<template>
  <ErrorBoundary v-for="entry in store.stack.value" :key="entry.key">
    <component :is="entry.component" v-bind="entry.props" @close="store.close(entry.key)" />
  </ErrorBoundary>
</template>
