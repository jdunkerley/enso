<script setup lang="ts">
/**
 * @file The versions of one asset, newest first, joined by a line. It waits for them in `setup`, so
 * it must be inside a `SuspenseLoader`. It owns the actions every version offers: restore,
 * duplicate (and open), and editing the version's comment.
 */
import Result from '$/components/Result/Result.vue'
import { useContainerData } from '$/providers/container'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { localVersioningStatusQueryOptions } from '$/utils/localVersioningQuery'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  BackendType,
  extractTypeAndPath,
  S3ObjectVersionId,
  type AssetVersions,
  type Backend,
  type DatalinkAsset,
  type FileAsset,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { ResultError } from 'enso-common/src/utilities/data/result'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { uniqueString } from 'enso-common/src/utilities/uniqueString'
import { computed } from 'vue'
import AssetVersion from './AssetVersion.vue'
import { assetVersionsQueryOptions } from './queries'
import type { DuplicateOptions, Version } from './version'

const { backend, item } = defineProps<{
  backend: Backend
  item: DatalinkAsset | FileAsset | ProjectAsset
}>()

const { getText } = useText()
const toasts = useToasts()
const queryClient = useQueryClient()
const { openProjectLocally } = useContainerData()
const openedProjects = useOpenedProjects()

/** Show an error toast, and log it. */
function toastAndLog(textId: 'restoreProjectError' | 'updateAssetBackendError', error: unknown) {
  const message = `${getText(textId, item.title)}: ${getMessageOrToString(error)}`
  toasts.show(message, { type: 'error' })
  console.error(message)
}

const versionsQueryOptions = assetVersionsQueryOptions(backend, item.id)
const versionsQuery = useQuery({ ...versionsQueryOptions, throwOnError: true })
await versionsQuery.suspense()

const versions = computed<Version[]>(() => {
  const list = versionsQuery.data.value?.versions ?? []
  return list.map((version, index) => {
    const number = list.length - index
    return {
      ...version,
      number,
      title: getText('versionX', number),
      tags: [...(version.isLatest ? [getText('latestIndicator')] : []), ...(version.tags ?? [])],
    }
  })
})
const latestVersion = computed(() => versions.value.find((version) => version.isLatest))

/**
 * Restore a version. A local project that is open (or opening) is closed first, saving its "Saved
 * on close" version, so nothing is lost; the shim refuses to restore a running project. A project
 * that is still opening has its opening aborted, but the backend open may still be in flight: then
 * the shim refuses the restore (an error toast) and the project is opened again; the data is safe.
 * Otherwise it is restored and opened again in the background, so the drive, where Restore was
 * chosen, stays in front; chosen in the project's own tab, that tab stays current, so the project
 * reopens in front. Closing the project unmounts its graph, and this list may go with it: the
 * sequence needs nothing of the component (the mutation's callbacks live in the mutation), so it
 * still finishes. If the close fails, nothing is restored and the error is shown; if the
 * restore fails, the project is still opened again, unchanged.
 */
async function restoreVersion(versionId: S3ObjectVersionId) {
  if (backend.type !== BackendType.local || item.type !== AssetType.project) {
    await backend.restoreAsset(item.id, versionId)
    return
  }
  const opened = openedProjects.get(item.id)
  if (opened == null || (opened.nextTask == null && opened.state.status === 'not-opened')) {
    await backend.restoreAsset(item.id, versionId)
    return
  }
  openedProjects.closeProject(item.id, undefined, { offer: false })
  await openedProjects.waitForProcess(opened)
  if (opened.error != null) {
    throw opened.error instanceof ResultError ? new Error(opened.error.message('')) : opened.error
  }
  try {
    await backend.restoreAsset(item.id, versionId)
  } finally {
    openProjectLocally(item, BackendType.local, false)
  }
}

const restoreMutation = useMutation({
  mutationFn: (variables: { versionId: S3ObjectVersionId; placeholderId: S3ObjectVersionId }) =>
    restoreVersion(variables.versionId),
  onError: (error: unknown) => toastAndLog('restoreProjectError', error),
  meta: {
    invalidates:
      backend.type === BackendType.local ?
        [
          versionsQueryOptions.queryKey,
          localVersioningStatusQueryOptions(null, extractTypeAndPath(item.id).path).queryKey,
        ]
      : [versionsQueryOptions.queryKey],
    awaitInvalidates: true,
  },
})

const duplicateMutation = useMutation(backendMutationOptions('copyAsset', backend))

const updateCommentMutation = useMutation(
  backendMutationOptions('updateAsset', backend, {
    onMutate: async ([, { versionId, comment }]) => {
      await queryClient.cancelQueries({ queryKey: versionsQueryOptions.queryKey })
      const previousVersions = queryClient.getQueryData<AssetVersions>(
        versionsQueryOptions.queryKey,
      )
      if (versionId != null) {
        queryClient.setQueryData<AssetVersions>(versionsQueryOptions.queryKey, (current) =>
          current == null ? current : (
            {
              ...current,
              versions: current.versions.map((version) =>
                version.versionId === versionId ?
                  { ...version, comment: comment ?? undefined }
                : version,
              ),
            }
          ),
        )
      }
      return { previousVersions }
    },
    onError: (error, _variables, context) => {
      const previousVersions = (context as { previousVersions?: AssetVersions } | undefined)
        ?.previousVersions
      if (previousVersions != null) {
        queryClient.setQueryData(versionsQueryOptions.queryKey, previousVersions)
      }
      toastAndLog('updateAssetBackendError', error)
    },
  }),
)

async function doDuplicate(options?: DuplicateOptions) {
  const newItem = await duplicateMutation.mutateAsync([item.id, item.parentId, options?.versionId])
  const newAsset = newItem.asset
  if (options?.start === true && newAsset.type === AssetType.project) {
    openProjectLocally(newAsset, backend.type)
  }
}

async function doRestore(version: Version) {
  await restoreMutation.mutateAsync({
    versionId: version.versionId,
    placeholderId: S3ObjectVersionId(uniqueString()),
  })
}

async function doUpdateComment(version: Version, comment: string | null) {
  await updateCommentMutation.mutateAsync([
    item.id,
    { versionId: version.versionId, comment },
    item.title,
  ])
}

function isUpdatingComment(version: Version) {
  return (
    updateCommentMutation.isPending.value &&
    updateCommentMutation.variables.value?.[1].versionId === version.versionId
  )
}
</script>

<template>
  <Result
    v-if="versions.length === 0"
    status="info"
    :centered="true"
    :title="getText('noVersionsFound')"
  />
  <Result
    v-else-if="latestVersion == null"
    status="error"
    :centered="true"
    :title="getText('fetchLatestVersionError')"
  />
  <div v-else class="flex h-full w-full flex-col overflow-auto">
    <div v-for="(version, index) in versions" :key="version.versionId">
      <AssetVersion
        :version="version"
        :otherVersions="versions"
        :item="item"
        :backend="backend"
        :previousVersion="versions[index + 1]"
        :doRestore="doRestore"
        :doDuplicate="doDuplicate"
        :doUpdateComment="doUpdateComment"
        :isUpdatingComment="isUpdatingComment(version)"
      />
      <div v-if="index !== versions.length - 1" class="ml-[3px] h-5 w-[0.5px] bg-primary" />
    </div>
  </div>
</template>
