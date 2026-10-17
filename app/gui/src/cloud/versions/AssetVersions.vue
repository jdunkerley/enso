<script setup lang="ts">
/**
 * @file The right panel's Versions tab: the versions of the asset selected in a cloud category, or
 * of a local project in an enabled git repository, newest first, with their tags and comments, and
 * actions to compare, restore or duplicate them.
 *
 * With nothing selected, for an asset without versions (in the cloud, only projects, files and
 * datalinks have them; locally, only projects), or for a local project whose versions are not kept
 * (no git, no repository, or the repository is not enabled) it says so, and if its status cannot be
 * read, it shows the error. The list itself (`AssetVersionList.vue`) loads in a `SuspenseLoader`,
 * and is remounted for each asset.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import Result from '$/components/Result/Result.vue'
import Loader from '$/components/Spinner/Loader.vue'
import { useBackends } from '$/providers/backends'
import { isCloudCategory, isLocalCategory } from '$/providers/category'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { includes } from '$/utils/data/array'
import { localVersioningStatusQueryOptions } from '$/utils/localVersioningQuery'
import { useQuery } from '@tanstack/vue-query'
import {
  AssetType,
  extractTypeAndPath,
  type AnyAsset,
  type Backend,
  type DatalinkAsset,
  type FileAsset,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed } from 'vue'
import AssetVersionList from './AssetVersionList.vue'

defineProps<{
  /** The panel's toolbar slot, given to every tab. This one puts nothing there. */
  toolbar?: HTMLElement | string | undefined
}>()

const rightPanel = useRightPanelData()
const { remoteBackend, localBackend } = useBackends()
const { getText } = useText()

/** Whether the asset can have versions. */
function hasVersions(asset: AnyAsset): asset is DatalinkAsset | FileAsset | ProjectAsset {
  return includes([AssetType.project, AssetType.datalink, AssetType.file], asset.type)
}

/** The selected local project's path, while a local category is shown. */
const localProjectPath = computed(() => {
  const category = rightPanel.context?.category
  const asset = rightPanel.focusedAsset
  if (category == null || !isLocalCategory(category) || asset?.type !== AssetType.project) {
    return null
  }
  return extractTypeAndPath(asset.id).path
})
const localStatusQuery = useQuery(
  computed(() => localVersioningStatusQueryOptions(localBackend ?? null, localProjectPath.value)),
)

type State =
  | { readonly placeholder: string }
  | { readonly error: string }
  | { readonly loading: true }
  | {
      readonly asset: DatalinkAsset | FileAsset | ProjectAsset
      readonly backend: Backend
    }

const state = computed((): State => {
  const category = rightPanel.context?.category
  const asset = rightPanel.focusedAsset
  if (category == null || asset == null) {
    return { placeholder: getText('assetVersions.notSelected') }
  }
  if (isCloudCategory(category)) {
    return hasVersions(asset) ?
        { asset, backend: remoteBackend }
      : { placeholder: getText('assetVersions.invalidAssetType') }
  }
  if (localBackend == null) return { placeholder: getText('assetVersions.localUnavailable') }
  if (asset.type !== AssetType.project) {
    return { placeholder: getText('assetVersions.localProjectsOnly') }
  }
  const status = localStatusQuery.data.value
  if (status == null) {
    const error: unknown = localStatusQuery.error.value
    return localStatusQuery.isError.value ?
        { error: getText('assetVersions.localStatusError', getMessageOrToString(error)) }
      : { loading: true }
  }
  if (!status.git) return { placeholder: getText('assetVersions.localNoGit') }
  if (status.repoRoot == null) return { placeholder: getText('assetVersions.localNoRepository') }
  if (!status.enabled) return { placeholder: getText('assetVersions.localNotEnabled') }
  return { asset, backend: localBackend }
})
</script>

<template>
  <Result v-if="'error' in state" status="error" :centered="true" :title="state.error" />
  <Result
    v-else-if="'placeholder' in state"
    status="info"
    :centered="true"
    :title="state.placeholder"
  />
  <Loader v-else-if="'loading' in state" />
  <ErrorBoundary v-else :key="state.asset.id">
    <SuspenseLoader>
      <AssetVersionList :backend="state.backend" :item="state.asset" />
    </SuspenseLoader>
  </ErrorBoundary>
</template>
