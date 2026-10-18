<script setup lang="ts">
/**
 * @file The right panel's Versions tab: the versions of the asset selected in a cloud category, or
 * of a local project in an enabled git repository, newest first, with their tags and comments, and
 * actions to compare, restore or duplicate them. In a project tab, it lists the opened project's
 * versions: a local project's are the local backend's, a cloud or hybrid project's the cloud's (by
 * its `id`). The project view gives only the project's id, so its asset is fetched first.
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
import { isLocalCategory } from '$/providers/category'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { backendQueryOptions } from '$/utils/backendQuery'
import { localVersioningStatusQueryOptions } from '$/utils/localVersioningQuery'
import { useQuery } from '@tanstack/vue-query'
import {
  AssetType,
  extractTypeAndPath,
  ProjectId,
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

/**
 * The project opened in this project tab, and the backend which holds it: the local backend for a
 * local project (`null` when there is none), the cloud for a cloud or hybrid one. `null` outside a
 * project tab.
 */
const openedProject = computed(() => {
  const opened = rightPanel.context?.openedProject
  if (opened == null) return null
  const local = opened.mode === 'local'
  return { id: opened.id, local, backend: local ? (localBackend ?? null) : remoteBackend }
})
/** The opened project's asset, which the list needs whole (its title and parent, too). */
const openedProjectQuery = useQuery(
  computed(() => {
    const backend = openedProject.value?.backend ?? null
    // Without an opened project the query is disabled, so its placeholder id is never fetched.
    const id = openedProject.value?.id ?? ProjectId('')
    return {
      ...backendQueryOptions(backend, 'getAssetDetails', [id, undefined]),
      enabled: backend != null,
    }
  }),
)

/** The path of the local project whose versions are listed, if it is one. */
const localProjectPath = computed(() => {
  const opened = openedProject.value
  if (opened != null) return opened.local ? extractTypeAndPath(opened.id).path : null
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

/** A local project's versions, if they are kept: it must be in an enabled git repository. */
function localProjectState(asset: ProjectAsset, backend: Backend): State {
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
  return { asset, backend }
}

/** The versions of the project opened in this project tab. */
function openedProjectState(opened: NonNullable<typeof openedProject.value>): State {
  if (opened.backend == null) return { placeholder: getText('assetVersions.localUnavailable') }
  const asset = openedProjectQuery.data.value
  if (asset === undefined) {
    const error: unknown = openedProjectQuery.error.value
    return openedProjectQuery.isError.value ?
        { error: getMessageOrToString(error) }
      : { loading: true }
  }
  if (asset?.type !== AssetType.project) {
    return { placeholder: getText('assetVersions.notSelected') }
  }
  return opened.local ?
      localProjectState(asset, opened.backend)
    : { asset, backend: opened.backend }
}

const state = computed((): State => {
  if (openedProject.value != null) return openedProjectState(openedProject.value)
  const category = rightPanel.context?.category
  const asset = rightPanel.focusedAsset
  if (category == null || asset == null) {
    return { placeholder: getText('assetVersions.notSelected') }
  }
  if (localBackend == null) return { placeholder: getText('assetVersions.localUnavailable') }
  if (asset.type !== AssetType.project) {
    return { placeholder: getText('assetVersions.localProjectsOnly') }
  }
  return localProjectState(asset, localBackend)
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
