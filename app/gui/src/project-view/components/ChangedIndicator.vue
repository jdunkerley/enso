<script setup lang="ts">
/**
 * @file The dot beside the project name in the top bar: the project has changed since its last
 * version. Shown only for a local project whose repository is enabled and whose status is known
 * (`$/providers/localVersioning`); an unknown status shows nothing rather than a stale dot.
 *
 * The dot's space is reserved wherever it can appear (a local project whose versions are kept), so
 * that its coming and going does not move what is beside it in the top bar, the zoom controls
 * included.
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

/** Whether a dot may show: the slot for it is kept even while there is none. */
const reserved = computed(() => mode === 'local' && localVersioning.hasVersioning(projectId))

const changed = computed(() => {
  if (mode !== 'local') return false
  const status = localVersioning.statusOf(projectId)
  return status?.enabled === true && status.changed
})
</script>

<template>
  <!-- The top bar gives its children a `min-height`; the wrapper takes it and stretches with the
       row, so the dot inside keeps its own size. -->
  <span v-if="reserved" class="ChangedIndicator" data-testid="project-changed-slot">
    <span
      v-if="changed"
      role="img"
      class="dot"
      :aria-label="getText('changedSinceLastVersion')"
      data-testid="project-changed-indicator"
    />
  </span>
</template>

<style scoped>
.ChangedIndicator {
  display: flex;
  /* The dot's width, so that the slot is the same with or without it. */
  width: 8px;
  flex: none;
  align-items: center;
}

.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: 0.6;
}
</style>
