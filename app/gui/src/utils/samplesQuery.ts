/**
 * @file The query options of the bundled samples' states (`<projects>/Samples`), defined once for
 * every caller (see `backendQuery.ts`). A host that has no bundled samples answers with an error,
 * which reads as "no samples", so the drive treats no row as a sample.
 */
import { BackendType } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { SamplesStatus } from 'enso-common/src/services/ProjectManager/types'

export const SAMPLES_STATUS_QUERY_KEY = [BackendType.local, 'samplesStatus'] as const

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
  }
}
