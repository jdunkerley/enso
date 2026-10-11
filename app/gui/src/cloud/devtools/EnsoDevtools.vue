<script setup lang="ts">
/**
 * @file The Enso developer tools (#172), mounted by `ProtectedLayout.vue` while signed in, in
 * development builds only (`registerCloud` contributes them there and nowhere else): the floating
 * Enso button opening the devtools panel, and the list of active developer overrides.
 *
 * The button hides with "Hide Devtools", and comes back from the user menu's "Toggle Enso
 * Devtools" (Enso team members only); the overrides list stays either way.
 */
import { useDevtoolsStore } from '$/providers/devTools'
import DevtoolsPanel from './DevtoolsPanel.vue'
import EnsoDevStatus from './EnsoDevStatus.vue'

const devtools = useDevtoolsStore()
</script>

<template>
  <DevtoolsPanel v-if="devtools.showEnsoDevtools" />
  <EnsoDevStatus />
</template>
