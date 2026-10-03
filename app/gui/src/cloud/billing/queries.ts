/**
 * @file The query behind the Usage settings tab: a month's summary of scheduled executions. It keeps
 * the React `backendQueryOptions`' key and its options there (fresh for a minute, not persisted);
 * the project-execution mutations invalidate it (`INVALIDATION_MAP`).
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'
import { MINUTE_MS } from 'enso-common/src/utilities/data/dateTime'

/** Options for a query of a month's (`YYYY-MM`) execution summary. */
export function listExecutionsSummaryQueryOptions(backend: Backend, month: string) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listExecutionsSummary', [{ month }]),
    queryFn: () => backend.listExecutionsSummary({ month }),
    staleTime: MINUTE_MS,
    meta: { persist: false },
  })
}
