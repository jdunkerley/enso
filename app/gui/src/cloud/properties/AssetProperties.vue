<script setup lang="ts">
/**
 * @file The right panel's Properties tab: the properties of the asset selected in a cloud category,
 * and the configuration of a secret or a datalink. The Vue port of the React
 * `AssetPanel/components/AssetProperties`.
 *
 * Outside the cloud, or with nothing selected, it says so. The content is remounted for each asset,
 * inside its own error boundary, as React's was.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import Result from '$/components/Result/Result.vue'
import { useBackends } from '$/providers/backends'
import { CATEGORY_BACKEND } from '$/providers/category'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { BackendType } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import AssetPropertiesContent from './AssetPropertiesContent.vue'

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
    return { placeholder: getText('assetProperties.localBackend') }
  } else if (asset == null) {
    return { placeholder: getText('assetProperties.notSelected') }
  } else {
    return { asset, category }
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
  <ErrorBoundary v-else-if="state.asset != null" :key="state.asset.id">
    <AssetPropertiesContent
      :backend="remoteBackend"
      :item="state.asset"
      :category="state.category"
    />
  </ErrorBoundary>
</template>
