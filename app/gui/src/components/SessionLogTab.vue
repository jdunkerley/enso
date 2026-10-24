<script setup lang="ts">
/**
 * @file The app's session log tab (Activity → Show Logs): one session of a project read from its
 * log file, in the engine log viewer the project view's Logs tab uses, without a live stream.
 */
import EngineLogPanel from '@/components/EngineLogs/EngineLogPanel.vue'
import type { ProjectLogTab } from '$/providers/container'

const { tab } = defineProps<{ tab: ProjectLogTab }>()
</script>

<template>
  <div class="SessionLogTab" data-testid="session-log-tab">
    <EngineLogPanel :initialSession="tab.id" :projectId="tab.projectId" />
  </div>
</template>

<style scoped>
.SessionLogTab {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
