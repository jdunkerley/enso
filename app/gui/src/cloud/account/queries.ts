/**
 * @file The query behind the API keys settings tab: the user's API keys. It keeps the React
 * `backendQueryOptions`' key and options (stale at once, persisted), so that the cache and its
 * persistence stay valid; `createApiKey` and `deleteApiKey` invalidate it (`INVALIDATION_MAP`).
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'

/** Options for a query of the user's API keys. */
export function listApiKeysQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listApiKeys', []),
    queryFn: () => backend.listApiKeys(),
    staleTime: 0,
    meta: { persist: true },
  })
}
