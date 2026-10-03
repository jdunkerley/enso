/**
 * @file The queries behind the right panel's Properties tab: a datalink's value and the
 * organization's labels. They keep the keys and options React's `backendQueryOptions` gave them, so
 * that the cache, its persistence and the invalidations of `INVALIDATION_MAP` behave as before.
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend, DatalinkId } from 'enso-common/src/services/Backend'

/** Options for a query of a datalink's value. */
export function datalinkQueryOptions(
  backend: Backend,
  datalinkId: DatalinkId,
  title: string,
  options: { readonly enabled: boolean; readonly refetchInterval: number | false },
) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'getDatalink', [datalinkId, title]),
    queryFn: () => backend.getDatalink(datalinkId, title),
    // As React's `backendQueryOptions` sets them for this method.
    staleTime: 0,
    meta: { persist: true },
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
  })
}

/** Options for a query of the organization's labels. */
export function labelsQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listTags', []),
    queryFn: () => backend.listTags(),
    // As React's `backendQueryOptions` sets them for this method (`PERSISTENCE_MAP`).
    staleTime: 0,
    meta: { persist: false },
  })
}
