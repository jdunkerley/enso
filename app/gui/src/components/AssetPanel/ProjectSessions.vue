<script setup lang="ts">
/**
 * @file The right panel's Activity tab: the sessions of the project the panel is focused on, the
 * project selected in the drive or the one opened in a project tab (#176). The Vue port of the
 * React `AssetPanel/components/ProjectSessions`.
 *
 * Without such a project it asks for one. The list itself (`ProjectSessionList.vue`) loads in a
 * `SuspenseLoader`, as React's suspended, and is remounted for each project.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import Result from '$/components/Result/Result.vue'
import { useBackends } from '$/providers/backends'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { AssetType } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import ProjectSessionList from './ProjectSessionList.vue'

defineProps<{
  /** The panel's toolbar slot, given to every tab. This one puts nothing there. */
  toolbar?: HTMLElement | string | undefined
}>()

const rightPanel = useRightPanelData()
const { backendForType } = useBackends()
const { getText } = useText()

const project = computed(() => rightPanel.sessionsProject)
const placeholder = computed(() => {
  const asset = rightPanel.focusedAsset
  return asset != null && asset.type !== AssetType.project ?
      getText('assetProjectSessions.notProjectAsset')
    : getText('assetProjectSessions.notSelected')
})
const projectKey = computed(() =>
  project.value ? `${project.value.backendType}:${project.value.id}:${project.value.title}` : '',
)
</script>

<template>
  <Result v-if="project == null" status="info" :centered="true" :title="placeholder" />
  <ErrorBoundary v-else :key="projectKey">
    <SuspenseLoader>
      <ProjectSessionList :backend="backendForType(project.backendType)" :project="project" />
    </SuspenseLoader>
  </ErrorBoundary>
</template>
