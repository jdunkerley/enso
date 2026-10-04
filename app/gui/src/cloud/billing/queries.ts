/**
 * @file The billing area's queries: a month's summary of scheduled executions (the Usage settings
 * tab), and the plans on offer (the subscription page). They keep the React `backendQueryOptions`'
 * keys and options: the summary fresh for a minute and not persisted, which the project-execution
 * mutations invalidate (`INVALIDATION_MAP`); the plans stale at once and persisted.
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

/** Options for the query of the plan cards the subscription page offers. */
export function paymentsConfigQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'getPaymentsConfig', []),
    queryFn: () => backend.getPaymentsConfig(),
    staleTime: 0,
    meta: { persist: true },
  })
}
