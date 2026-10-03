<script setup lang="ts">
/**
 * @file The right panel's Schedule tab: a calendar of the scheduled executions of the project
 * selected in a cloud category. The Vue port of the React
 * `AssetPanel/components/ProjectExecutionsCalendar`.
 *
 * Outside the cloud, with nothing selected, or for an asset that is not a project it says so. The
 * tab is enabled only on plans with the scheduler (`$/providers/rightPanel`, unchanged). The
 * calendar is inside its own error boundary, as React's was.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import Result from '$/components/Result/Result.vue'
import { useBackends } from '$/providers/backends'
import { CATEGORY_BACKEND } from '$/providers/category'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { AssetType, BackendType } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import ProjectExecutionsCalendarContent from './ProjectExecutionsCalendarContent.vue'

defineProps<{
  /** The panel's toolbar slot, given to every tab. This one puts nothing there. */
  toolbar?: HTMLElement | string | undefined
}>()

const rightPanel = useRightPanelData()
const { remoteBackend } = useBackends()
const { getText } = useText()

const state = computed(() => {
  const category = rightPanel.context?.category
  const asset = rightPanel.focusedAsset
  if (category == null || CATEGORY_BACKEND[category.type] !== BackendType.remote) {
    return { placeholder: getText('assetProjectExecutionsCalendar.localBackend') }
  } else if (asset == null) {
    return { placeholder: getText('assetProjectExecutionsCalendar.notSelected') }
  } else if (asset.type !== AssetType.project) {
    return { placeholder: getText('assetProjectExecutionsCalendar.notProjectAsset') }
  } else {
    return { asset }
  }
})
</script>

<template>
  <Result
    v-if="state.placeholder != null"
    status="info"
    :centered="true"
    :title="state.placeholder"
  />
  <!-- Not keyed by the project, as React's was not: the chosen day and month stay as the selection
  moves to another project. -->
  <ErrorBoundary v-else-if="state.asset != null">
    <ProjectExecutionsCalendarContent :backend="remoteBackend" :item="state.asset" />
  </ErrorBoundary>
</template>
