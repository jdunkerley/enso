<script setup lang="ts">
/**
 * @file The layout every page is under: it sets the app title and marks the app as signed in. There
 * is no sign-in, so it checks no access and redirects nowhere: the app always runs as the local user.
 */
import { useAppTitle } from '$/composables/appTitle'
import { useAuth } from '$/providers/auth'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useAppClass } from '@/providers/appClass'
import { computed } from 'vue'

const auth = useAuth()

const debugHoverAreas = useFeatureFlag('debugHoverAreas')
useAppClass(() => ({ debugHoverAreas: debugHoverAreas.value }))

useAppTitle(computed(() => auth.session))
</script>

<template>
  <!-- Markers the integration tests' login helpers wait for (until PR 4 removes them). -->
  <div v-if="auth.session == null" data-testid="before-auth-layout" aria-hidden></div>
  <div v-else data-testid="after-auth-layout" aria-hidden></div>
  <RouterView />
</template>
