/**
 * @file The queries behind the Members settings tab and the invitation dialog: the organization's
 * members and its pending invitations. They keep the React `backendQueryOptions`' keys and options
 * (persisted, stale after a minute), so that the cache and its persistence stay valid.
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'

/** How long the members and invitations stay fresh, as in React. */
const LIST_USERS_STALE_TIME_MS = 60_000

/** Options for a query of the organization's members. */
export function listUsersQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listUsers', []),
    queryFn: () => backend.listUsers(),
    staleTime: LIST_USERS_STALE_TIME_MS,
    meta: { persist: true },
  })
}

/** Options for a query of the organization's pending invitations and its free seats. */
export function listInvitationsQueryOptions(
  backend: Backend,
  staleTime: number = LIST_USERS_STALE_TIME_MS,
) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listInvitations', []),
    queryFn: () => backend.listInvitations(),
    staleTime,
    meta: { persist: true },
  })
}
