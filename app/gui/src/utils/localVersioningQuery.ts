/**
 * @file Query options for the versioning status of a local path (a project, or the local root),
 * read once per mount by the settings page's Versions section (PR 4) and the right panel's Versions
 * tab (PR 5). The open projects' statuses are polled by `$/providers/localVersioning` instead,
 * which never overlaps requests.
 */
import { BackendType, type Path } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'

/**
 * Query options for the versioning status of `path`. Disabled, and resolving to `null`, without a
 * path or a local backend, so a caller with nothing selected needs no placeholder path.
 */
export function localVersioningStatusQueryOptions(backend: LocalBackend | null, path: Path | null) {
  return {
    queryKey: [BackendType.local, 'versioningStatus', path] as const,
    queryFn: (): Promise<VersioningStatus | null> =>
      backend == null || path == null ? Promise.resolve(null) : backend.versioningStatus(path),
    enabled: backend != null && path != null,
    networkMode: 'always' as const,
    meta: { persist: false },
  }
}
