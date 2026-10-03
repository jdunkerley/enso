/**
 * @file The queries behind the organization's settings tabs and the invitation dialog: the
 * organization's members, its pending invitations, its user groups and its activity log. They keep
 * the React `backendQueryOptions`' keys and options, so that the cache and its persistence stay
 * valid.
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend, GetLogEventsRequestParams } from 'enso-common/src/services/Backend'
import { MINUTE_MS } from 'enso-common/src/utilities/data/dateTime'
import { computed, type Ref } from 'vue'

/** How long the members and invitations stay fresh, as in React. */
const LIST_USERS_STALE_TIME_MS = 60_000

/**
 * Options for a query of the organization's members. The Members tab keeps them fresh for a minute;
 * the user groups and the activity log use React's default for `listUsers`, `Infinity`.
 */
export function listUsersQueryOptions(
  backend: Backend,
  staleTime: number = LIST_USERS_STALE_TIME_MS,
  enabled: Ref<boolean> | boolean = true,
) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listUsers', []),
    queryFn: () => backend.listUsers(),
    staleTime,
    enabled,
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

/** Options for a query of the organization's user groups: stale at once, persisted, as in React. */
export function listUserGroupsQueryOptions(backend: Backend) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listUserGroups', []),
    queryFn: () => backend.listUserGroups(),
    staleTime: 0,
    meta: { persist: true },
  })
}

/** The activity log's filters, and how many events a page holds. */
export type LogEventsFilter = Omit<GetLogEventsRequestParams, 'from'> & {
  readonly pageSize: number
}

/**
 * Options for the activity log, a page at a time: fresh for a minute and not persisted, under
 * React's key (the request's filters, then `{ infinite: true }`). The filters are reactive, and
 * the key follows them.
 */
export function logEventsQueryOptions(backend: Backend, filter: () => LogEventsFilter) {
  return {
    ...backendBaseOptions(backend),
    queryKey: computed(() =>
      backendQueryKey(backend, 'getLogEvents', [filter()], [{ infinite: true }]),
    ),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      backend.getLogEvents({ from: pageParam, ...filter() }),
    initialPageParam: 0,
    getPreviousPageParam: (currentPage: unknown, allPages: readonly unknown[]) =>
      (allPages.indexOf(currentPage) - 1) * filter().pageSize,
    getNextPageParam: (currentPage: unknown, allPages: readonly unknown[]) =>
      (allPages.indexOf(currentPage) + 1) * filter().pageSize,
    staleTime: MINUTE_MS,
    meta: { persist: false },
  }
}
