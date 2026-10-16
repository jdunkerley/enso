/**
 * @file The query of a backend's labels, shared by the drive's labels popover and the cloud's
 * Properties tab. It keeps the key and options `backendQueryOptions` gives `listTags`, so that the
 * cache, its persistence and the invalidations of `INVALIDATION_MAP` behave the same.
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'

/** Options for a query of the backend's labels. */
export function labelsQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listTags', []),
    queryFn: () => backend.listTags(),
    // As `backendQueryOptions` sets them for this method (`PERSISTENCE_MAP`).
    staleTime: 0,
    meta: { persist: false },
  })
}
