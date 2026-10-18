/**
 * @file The Vue side of the backend's queries and mutations: reactive wrappers over the
 * framework-free options in `$/utils/backendQuery`, which hold every per-method default, so that a
 * key means the same wherever it is used ("Rulings from #192").
 */
import {
  backendMutationOptions as backendMutationOptionsFor,
  backendQueryDefaults,
  backendQueryKey,
  callBackendMethod,
  type BackendMutationMethod,
  type BackendQueryMethod,
} from '$/utils/backendQuery'
import type { ToValue } from '$/utils/reactivity'
import type { UseMutationOptions } from '@tanstack/vue-query'
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
    ...backendQueryDefaults(method),
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
