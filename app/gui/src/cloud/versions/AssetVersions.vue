<script setup lang="ts">
/**
 * @file The right panel's Versions tab: the versions of the asset selected in a cloud category,
 * newest first, with their tags and comments, and actions to compare, restore or duplicate them.
 *
 * Outside the cloud, with nothing selected, or for an asset without versions (only projects, files
 * and datalinks have them) it says so. The list itself (`AssetVersionList.vue`) loads in a
 * `SuspenseLoader`, and is remounted for each asset.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import Result from '$/components/Result/Result.vue'
import { useBackends } from '$/providers/backends'
import { CATEGORY_BACKEND } from '$/providers/category'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { includes } from '$/utils/data/array'
import {
  AssetType,
  BackendType,
  type AnyAsset,
  type DatalinkAsset,
  type FileAsset,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import AssetVersionList from './AssetVersionList.vue'

defineProps<{
  /** The panel's toolbar slot, given to every tab. This one puts nothing there. */
  toolbar?: HTMLElement | string | undefined
}>()

const rightPanel = useRightPanelData()
const { remoteBackend } = useBackends()
const { getText } = useText()

/** Whether the asset can have versions. */
function hasVersions(asset: AnyAsset): asset is DatalinkAsset | FileAsset | ProjectAsset {
  return includes([AssetType.project, AssetType.datalink, AssetType.file], asset.type)
}

const state = computed(() => {
  const category = rightPanel.context?.category
  const asset = rightPanel.focusedAsset
  if (category == null || CATEGORY_BACKEND[category.type] !== BackendType.remote) {
    return { placeholder: getText('assetVersions.localAssetsDoNotHaveVersions') }
  } else if (asset == null) {
    return { placeholder: getText('assetVersions.notSelected') }
  } else if (!hasVersions(asset)) {
    return { placeholder: getText('assetVersions.invalidAssetType') }
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
  <ErrorBoundary v-else-if="state.asset != null" :key="state.asset.id">
    <SuspenseLoader>
      <AssetVersionList :backend="remoteBackend" :item="state.asset" />
    </SuspenseLoader>
  </ErrorBoundary>
</template>
