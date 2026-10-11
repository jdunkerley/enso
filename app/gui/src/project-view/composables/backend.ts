/**
 * @file The Vue side of the backend's queries and mutations: reactive wrappers over the
 * framework-free options in `$/utils/backendQuery`, which hold every per-method default, so that a
 * key means the same wherever it is used ("Rulings from #192").
 */
import { useBackends } from '$/providers/backends'
import {
  backendMutationOptions as backendMutationOptionsFor,
  backendQueryDefaults,
  backendQueryKey,
  callBackendMethod,
  type BackendMutationMethod,
  type BackendQueryMethod,
} from '$/utils/backendQuery'
import type { ToValue } from '$/utils/reactivity'
import type { UseMutationOptions, UseMutationReturnType } from '@tanstack/vue-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'
import type { HttpClient } from 'enso-common/src/services/HttpClient'
import { computed, toValue, type UnwrapRef } from 'vue'
// eslint-disable-next-line vue/prefer-import-from-vue
import '@vue/reactivity'

declare module '@vue/reactivity' {
  interface RefUnwrapBailTypes {
    guiBailTypes: Backend | HttpClient
  }
}

/**
 * Options for a query of a backend method, kept up to date with its arguments: the query is
 * disabled while they are `undefined`. Its network mode, stale time and persistence are the
 * method's ({@link backendQueryDefaults}).
 */
export function backendQueryOptions<Method extends BackendQueryMethod, B extends Backend | null>(
  method: Method,
  args: ToValue<Parameters<Backend[Method]> | undefined>,
  backend: B,
) {
  return {
    ...backendQueryDefaults(backend, method),
    queryKey: computed(() => {
      const argsValue = toValue(args)
      return argsValue ? backendQueryKey(backend, method, argsValue) : []
    }),
    queryFn: (): Promise<
      B extends Backend ? Awaited<ReturnType<Backend[Method]>>
      : Awaited<ReturnType<Backend[Method]>> | null
    > =>
      backend ?
        (callBackendMethod(backend, method, toValue(args)!) as any)
      : (Promise.resolve(null) as any),
    enabled: computed(() => !!backend && !!toValue(args)),
  }
}

type MutationOptions<Method extends BackendMutationMethod, B extends Backend | null> = ToValue<
  Omit<
    UnwrapRef<
      UseMutationOptions<
        B extends Backend ? Awaited<ReturnType<Backend[Method]>>
        : Awaited<ReturnType<Backend[Method]>> | null,
        Error,
        Parameters<Backend[Method]>
      >
    >,
    'mutationFn'
  > & { invalidate?: boolean }
>

/**
 * Create Tanstack Query mutation options for given backend method call.
 */
export function backendMutationOptions<
  Method extends BackendMutationMethod,
  B extends Backend | null,
>(
  method: Method,
  backend: ToValue<B>,
  options?: MutationOptions<Method, B>,
): UseMutationOptions<
  B extends Backend ? Awaited<ReturnType<Backend[Method]>>
  : Awaited<ReturnType<Backend[Method]>> | null,
  Error,
  Parameters<Backend[Method]>
> {
  return computed(() => {
    const { invalidate, ...opts } = toValue(options) ?? {}
    const backendValue = toValue(backend)
    return {
      // The options' refs are unwrapped by vue-query, as before.
      ...backendMutationOptionsFor(backendValue, method, {
        ...(opts as any),
        mutationKey: toValue(opts.mutationKey) ?? [],
        ...(invalidate != null ? { invalidate } : {}),
      }),
      mutationFn: (args: Parameters<Backend[Method]>) =>
        backendValue ?
          callBackendMethod(backendValue, method, args)
        : (Promise.resolve(null) as any),
    }
  }) as any
}

/**
 * Composable providing access to the backend API.
 * @param which - Whether to use the remote backend, or the current project's backend (which may be the remote backend,
 * or a local backend).
 */
export function useBackend(which: 'remote' | 'project') {
  const queryClient = useQueryClient()
  const { localBackend: project, remoteBackend: remote } = useBackends()
  const backend: Backend | null = which === 'project' ? project : remote

  /** Perform the specified query, and keep the result up-to-date if the provided arguments change. */
  function query<Method extends BackendQueryMethod>(
    method: Method,
    args: ToValue<Parameters<Backend[Method]> | undefined>,
  ) {
    return useQuery(backendQueryOptions(method, args, backend))
  }

  function fetch<Method extends BackendQueryMethod>(
    method: Method,
    args: ToValue<Parameters<Backend[Method]> | undefined>,
  ) {
    return queryClient.fetchQuery(backendQueryOptions(method, args, backend))
  }

  /** Enable prefetching of the specified query. */
  function prefetch<Method extends BackendQueryMethod>(
    method: Method,
    args: ToValue<Parameters<Backend[Method]> | undefined>,
  ) {
    return queryClient.prefetchQuery(backendQueryOptions(method, args, backend))
  }

  /** Return query results from the cache (even if stale), or if no cached data is available fetch the data. */
  function ensureQueryData<Method extends BackendQueryMethod>(
    method: Method,
    args: ToValue<Parameters<Backend[Method]> | undefined>,
  ) {
    return queryClient.ensureQueryData(backendQueryOptions(method, args, backend))
  }

  function mutation<Method extends BackendMutationMethod>(
    method: Method,
    options?: MutationOptions<Method, Backend | null>,
  ): UseMutationReturnType<
    Awaited<ReturnType<Backend[Method]>> | null,
    Error,
    Parameters<Backend[Method]>,
    unknown
  > {
    return useMutation(backendMutationOptions<Method, Backend | null>(method, backend, options))
  }

  return { query, fetch, prefetch, ensureQueryData, mutation }
}

export type Mutation = ReturnType<typeof useBackend>['mutation']
