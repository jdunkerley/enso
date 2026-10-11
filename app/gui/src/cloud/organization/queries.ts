/**
 * @file The queries behind the organization's settings tabs and the invitation dialog: the
 * organization's members, its pending invitations, its user groups and its activity log. They keep
 * the keys and options `backendQueryOptions` gives them, so that the cache and its persistence stay
 * valid.
 */
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { queryOptions } from '@tanstack/vue-query'
import type { Backend, GetLogEventsRequestParams } from 'enso-common/src/services/Backend'
import { MINUTE_MS } from 'enso-common/src/utilities/data/dateTime'
import { computed, type Ref } from 'vue'

/** How long the members and invitations stay fresh. */
const LIST_USERS_STALE_TIME_MS = 60_000

/**
 * Options for a query of the organization's members. The Members tab keeps them fresh for a minute;
 * the user groups and the activity log use `Infinity`.
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

/** Options for a query of the organization's user groups: stale at once, persisted. */
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
 * The offset of the activity log's next page, or `undefined` once there is none. The endpoint
 * pages by offset and gives no cursor or total, so a page shorter than `pageSize` (empty included)
 * is the end of the log. Without this end the query always reports a next page, and the tab,
 * which asks for one while the list does not fill its view, asks forever (#196).
 */
export function nextLogEventsPageParam(
  lastPage: readonly unknown[],
  allPages: readonly (readonly unknown[])[],
  pageSize: number,
) {
  return lastPage.length < pageSize ? undefined : allPages.length * pageSize
}

/**
 * Options for the activity log, a page at a time: fresh for a minute and not persisted, under
 * the key used before the Vue port (#75): the request's filters, then `{ infinite: true }`. The
 * filters are reactive, and the key follows them.
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
    getNextPageParam: (lastPage: readonly unknown[], allPages: readonly (readonly unknown[])[]) =>
      nextLogEventsPageParam(lastPage, allPages, filter().pageSize),
    staleTime: MINUTE_MS,
    meta: { persist: false },
  }
}
