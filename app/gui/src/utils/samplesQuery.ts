/**
 * @file The query options of the bundled samples' states (`<projects>/Samples`), defined once for
 * every caller (see `backendQuery.ts`). A host that has no bundled samples answers with an error,
 * which reads as "no samples", so the drive treats no row as a sample.
 */
import { BackendType } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { SamplesStatus } from 'enso-common/src/services/ProjectManager/types'

export const SAMPLES_STATUS_QUERY_KEY = [BackendType.local, 'samplesStatus'] as const

/**
 * How long a status stays fresh. Every project row of the Drive uses it, and a sample's state
 * changes only through an edit, a reset (which refetches it) or a new version, so it need not be
 * asked for at each mount or focus.
 */
export const SAMPLES_STATUS_STALE_TIME_MS = 60_000

/** The query of the bundled samples' states on `backend`; disabled without one. */
export function samplesStatusQueryOptions(backend: LocalBackend | null | undefined) {
  return {
    queryKey: SAMPLES_STATUS_QUERY_KEY,
    queryFn: async (): Promise<SamplesStatus | null> => {
      if (backend == null) return null
      try {
        return await backend.samplesStatus()
      } catch (error) {
        console.warn('The bundled samples are not available:', error)
        return null
      }
    },
    enabled: backend != null,
    staleTime: SAMPLES_STATUS_STALE_TIME_MS,
  }
}
