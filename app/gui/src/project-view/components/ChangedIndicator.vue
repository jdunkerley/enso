<script setup lang="ts">
/**
 * @file The dot beside the project name in the top bar: the project has changed since its last
 * version. Shown only for a local project whose repository is enabled and whose status is known
 * (`$/providers/localVersioning`); an unknown status shows nothing rather than a stale dot.
 */
import { useLocalVersioning } from '$/providers/localVersioning'
import type { RunMode } from '$/providers/openedProjects/projectInfo'
import { useText } from '$/providers/text'
import type { ProjectId } from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { projectId, mode } = defineProps<{
  projectId: ProjectId
  mode: RunMode
}>()

const localVersioning = useLocalVersioning()
const { getText } = useText()

const changed = computed(() => {
  if (mode !== 'local') return false
  const status = localVersioning.statusOf(projectId)
  return status?.enabled === true && status.changed
})
</script>

<template>
  <span
    v-if="changed"
    role="img"
    class="ChangedIndicator"
    :aria-label="getText('changedSinceLastVersion')"
    data-testid="project-changed-indicator"
  />
</template>

<style scoped>
.ChangedIndicator {
  align-self: center;
  width: 8px;
  height: 8px;
  min-height: 8px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0.6;
}
</style>
