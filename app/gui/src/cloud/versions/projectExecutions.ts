/**
 * @file Query options for a project's scheduled executions, which only the Enso Cloud has. Moved
 * out of the React `#/hooks/backendHooks` (#192) with the same keys and stale time, for the
 * Schedule tab, which #183 ports here.
 */
import { backendQueryOptions } from '$/utils/backendQuery'
import type { Backend, ProjectId } from 'enso-common/src/services/Backend'

/** How long a project's executions stay fresh, in milliseconds. */
const PROJECT_EXECUTIONS_STALE_TIME_MS = 60_000

/** Query options for the executions of a project in a month. */
export function listProjectExecutionsQueryOptions(
  backend: Backend,
  id: ProjectId,
  title: string,
  year: number,
  month: number,
) {
  return backendQueryOptions(backend, 'listProjectExecutions', [id, title, year, month], {
    staleTime: PROJECT_EXECUTIONS_STALE_TIME_MS,
  })
}
