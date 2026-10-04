/**
 * @file The queries behind the right panel's Versions tab: an asset's versions, and the contents of
 * a project version's `Main.enso`, plus the optimistic tag updates. The Vue port of the React
 * `AssetPanel/components/queries.ts` and of the version-tag hooks in `#/hooks/backendHooks`, with
 * the same query keys and options (the shared `backendQueryOptions`, #192), so that the cache, its
 * persistence and the invalidations of `INVALIDATION_MAP` behave as before.
 */
import { backendQueryKey, backendQueryOptions } from '$/utils/backendQuery'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import type {
  AssetId,
  AssetVersions,
  Backend,
  DatalinkId,
  FileId,
  ProjectId,
  S3ObjectVersionId,
} from 'enso-common/src/services/Backend'
import { splitFileContents } from 'ydoc-shared/ensoFile'

/** The query key of an asset's versions. */
export function assetVersionsQueryKey(backend: Backend, assetId: AssetId) {
  return backendQueryKey(backend, 'listAssetVersions', [assetId])
}

/** Options for a query of the versions of an asset. */
export function assetVersionsQueryOptions(
  backend: Backend,
  assetId: DatalinkId | FileId | ProjectId,
) {
  return backendQueryOptions(backend, 'listAssetVersions', [assetId])
}

/** Options for a query of the organization's version tags, offered as suggestions. */
export function versionTagsQueryOptions(backend: Backend) {
  return backendQueryOptions(backend, 'listAssetVersionTags', [])
}

/** Options for a query of the contents of a project version's `Main.enso`. */
export function versionContentQueryOptions(params: {
  readonly backend: Backend
  readonly projectId: ProjectId
  readonly versionId?: S3ObjectVersionId | undefined
  /** If `false` (the default), the metadata is stripped out. */
  readonly metadata?: boolean
}) {
  const { backend, projectId, versionId, metadata = false } = params
  return {
    queryKey: [backend.type, { method: 'getFileContent', versionId, projectId }],
    queryFn: () => backend.getMainFileContent(projectId, versionId),
    select: (data: string) => (metadata ? data : splitFileContents(data).code),
  }
}

/** Apply `updateTags` to the tags of one version in a cached version list. */
function mapVersionTags(
  versions: AssetVersions,
  versionId: S3ObjectVersionId,
  updateTags: (tags: readonly string[]) => readonly string[],
): AssetVersions {
  return {
    ...versions,
    versions: versions.versions.map((version) =>
      version.versionId !== versionId ?
        version
      : { ...version, tags: [...updateTags(version.tags ?? [])] },
    ),
  }
}

/**
 * Add or remove a version's tag, showing the change at once. The cached list is restored if the
 * request fails, and refetched either way.
 */
function useUpdateVersionTag(
  backend: Backend,
  remove: boolean,
  optimisticUpdate: (tag: string, tags: readonly string[]) => readonly string[],
) {
  const queryClient = useQueryClient()
  const updateAsset = useMutation(backendMutationOptions('updateAsset', backend))

  return async (assetId: AssetId, versionId: S3ObjectVersionId, tag: string) => {
    const queryKey = assetVersionsQueryKey(backend, assetId)
    await queryClient.cancelQueries({ queryKey })
    const previousVersions = queryClient.getQueryData<AssetVersions>(queryKey)
    if (previousVersions != null) {
      queryClient.setQueryData<AssetVersions>(
        queryKey,
        mapVersionTags(previousVersions, versionId, (tags) => optimisticUpdate(tag, tags)),
      )
    }
    try {
      await updateAsset.mutateAsync([assetId, { versionId, tag, remove }, assetId])
    } catch (error) {
      if (previousVersions != null) queryClient.setQueryData(queryKey, previousVersions)
      throw error
    } finally {
      await queryClient.invalidateQueries({ queryKey })
    }
  }
}

/** A function adding a tag to an asset's version. */
export function useAddVersionTag(backend: Backend) {
  return useUpdateVersionTag(backend, false, (tag, tags) =>
    tags.includes(tag) ? tags : [...tags, tag],
  )
}

/** A function removing a tag from an asset's version. */
export function useRemoveVersionTag(backend: Backend) {
  return useUpdateVersionTag(backend, true, (tag, tags) =>
    tags.filter((existingTag) => existingTag !== tag),
  )
}
