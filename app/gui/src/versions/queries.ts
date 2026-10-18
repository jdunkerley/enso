/**
 * @file The queries behind the right panel's Versions tab: an asset's versions, and the contents of
 * a project version's `Main.enso`. Their keys and options come from the shared
 * `backendQueryOptions` (#192), so that the cache, its persistence and the invalidations of
 * `INVALIDATION_MAP` behave as before.
 */
import { backendQueryKey, backendQueryOptions } from '$/utils/backendQuery'
import type {
  AssetId,
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
