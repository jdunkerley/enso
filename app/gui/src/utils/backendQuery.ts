/**
 * @file The framework-free query and mutation options for the backend's methods. vue-query and
 * direct `QueryClient` calls consume the same objects, and every per-method default (stale time,
 * persistence, invalidations) is defined once, here: they all share one `QueryClient`, so they must
 * agree on what a key means ("Rulings from #192").
 */
import type {
  DataTag,
  Mutation,
  MutationOptions,
  NetworkMode,
  QueryClient,
  QueryKey,
  QueryMeta,
} from '@tanstack/query-core'
import type { Backend } from 'enso-common/src/services/Backend'
import * as backendModule from 'enso-common/src/services/Backend'
import { omit, type ExtractKeys, type MethodOf } from 'enso-common/src/utilities/data/object'

/** The properties of the Backend type that are methods. */
export type BackendMethods = ExtractKeys<Backend, MethodOf<Backend>>

/** Ensure that the given type contains only names of backend methods. */
type DefineBackendMethods<T extends BackendMethods> = T

/** Names of methods corresponding to mutations. */
export type BackendMutationMethod = DefineBackendMethods<
  | 'acceptInvitation'
  | 'associateTag'
  | 'changeUserGroup'
  | 'closeProject'
  | 'copyAsset'
  | 'cancelSubscription'
  | 'createCheckoutSession'
  | 'createCredential'
  | 'createDatalink'
  | 'createDirectory'
  | 'createPermission'
  | 'createApiKey'
  | 'createProject'
  | 'createProjectExecution'
  | 'createSecret'
  | 'createTag'
  | 'createUser'
  | 'createUserGroup'
  | 'declineInvitation'
  | 'deleteAsset'
  | 'deleteDatalink'
  | 'deleteInvitation'
  | 'deleteApiKey'
  | 'deleteProjectExecution'
  | 'deleteTag'
  | 'deleteUser'
  | 'deleteUserGroup'
  | 'duplicateProject'
  | 'exportArchive'
  | 'inviteUser'
  | 'logEvent'
  | 'openProject'
  | 'removeUser'
  | 'resendInvitation'
  | 'restoreUser'
  | 'syncProjectExecution'
  | 'undoDeleteAsset'
  | 'updateAsset'
  | 'updateDirectory'
  | 'updateFile'
  | 'updateOrganization'
  | 'updateProject'
  | 'updateProjectExecution'
  | 'updateSecret'
  | 'updateUser'
  | 'uploadFileChunk'
  | 'uploadFileEnd'
  | 'uploadFileStart'
  | 'uploadImage'
  | 'uploadOrganizationPicture'
  | 'uploadUserPicture'
>

/** Names of methods corresponding to queries. */
export type BackendQueryMethod = Exclude<BackendMethods, BackendMutationMethod>

/**
 * How long the organization and the signed-in user stay fresh: long enough that the screens
 * reading them do not refetch on every mount, short enough that a subscription or profile changed
 * elsewhere (another device, the billing page) shows within minutes (the maintainer's choice on
 * #201).
 */
export const ACCOUNT_STALE_TIME_MS = 5 * 60 * 1000

/**
 * The stale time of the methods whose data does not go stale as soon as it arrives (the default
 * is 0). A caller's own `staleTime` takes precedence.
 */
export const STALE_TIME_MAP: Partial<Record<BackendQueryMethod, number>> = {
  getOrganization: ACCOUNT_STALE_TIME_MS,
  usersMe: ACCOUNT_STALE_TIME_MS,
  listUsers: Infinity,
}

/**
 * The methods whose results are never persisted (the default is to persist). This takes
 * precedence over a caller's `meta.persist`.
 */
export const PERSISTENCE_MAP: Partial<Record<BackendQueryMethod, false>> = {
  listDirectory: false,
  searchDirectory: false,
  listTags: false,
  getAssetDetails: false,
}

/** A value for {@link INVALIDATION_MAP} representing all queries. */
export const INVALIDATE_ALL_QUERIES = Symbol('invalidate all queries')
/** A mapping between mutation methods and queries invalidated by them. */
export const INVALIDATION_MAP: Partial<
  Record<BackendMutationMethod, readonly (BackendQueryMethod | typeof INVALIDATE_ALL_QUERIES)[]>
> = {
  createUser: ['usersMe'],
  updateUser: [INVALIDATE_ALL_QUERIES],
  deleteUser: [
    'usersMe',
    'listUsers',
    'listUserGroups',
    'listDirectory',
    'searchDirectory',
    'getAssetDetails',
  ],
  removeUser: [
    'usersMe',
    'listUsers',
    'listUserGroups',
    'listDirectory',
    'searchDirectory',
    'getAssetDetails',
  ],
  restoreUser: ['usersMe'],
  inviteUser: ['listInvitations'],
  deleteInvitation: ['listInvitations'],
  uploadUserPicture: ['usersMe'],
  updateOrganization: ['getOrganization'],
  uploadOrganizationPicture: ['getOrganization'],
  createUserGroup: [INVALIDATE_ALL_QUERIES],
  deleteUserGroup: [INVALIDATE_ALL_QUERIES],
  changeUserGroup: [INVALIDATE_ALL_QUERIES],
  createTag: ['listTags'],
  deleteTag: ['listTags'],
  associateTag: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  acceptInvitation: [INVALIDATE_ALL_QUERIES],
  declineInvitation: ['usersMe'],
  createProject: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  duplicateProject: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  createDirectory: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  createSecret: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  updateSecret: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  updateProject: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  updateFile: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  updateDirectory: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  createDatalink: ['listDirectory', 'searchDirectory', 'getDatalink', 'getAssetDetails'],
  uploadFileEnd: ['listDirectory', 'searchDirectory', 'listAssetVersions', 'getAssetDetails'],
  copyAsset: ['listDirectory', 'searchDirectory', 'listAssetVersions', 'getAssetDetails'],
  deleteAsset: ['listDirectory', 'searchDirectory', 'listAssetVersions', 'getAssetDetails'],
  undoDeleteAsset: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  updateAsset: ['listDirectory', 'searchDirectory', 'listAssetVersions', 'getAssetDetails'],
  openProject: ['listDirectory', 'searchDirectory', 'getAssetDetails'],
  closeProject: ['listDirectory', 'searchDirectory', 'listAssetVersions', 'getAssetDetails'],
  createProjectExecution: ['listProjectExecutions', 'listExecutionsSummary'],
  updateProjectExecution: ['listProjectExecutions', 'listExecutionsSummary'],
  syncProjectExecution: ['listProjectExecutions', 'listExecutionsSummary'],
  deleteProjectExecution: ['listProjectExecutions', 'listExecutionsSummary'],
  createApiKey: ['listApiKeys'],
  deleteApiKey: ['listApiKeys'],
  uploadImage: ['listDirectory', 'searchDirectory'],
}

/** For each backend method, an optional function defining how to create a query key from its arguments. */
type BackendQueryNormalizers = {
  [Method in BackendMethods]?: (
    ...args: Readonly<Parameters<Backend[Method]>>
  ) => readonly unknown[]
}

const NORMALIZE_METHOD_QUERY: BackendQueryNormalizers = {
  listDirectory: (query) => [query.parentId, omit(query, 'parentId')],
  getFileDetails: (fileId) => [fileId],
}

/** Creates a partial query key representing the given method and arguments. */
function normalizeMethodQuery<Method extends BackendMethods>(
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
) {
  return NORMALIZE_METHOD_QUERY[method]?.(...args) ?? args
}

/** What a backend method resolves to. */
export type BackendMethodResult<Method extends BackendMethods> = Awaited<
  ReturnType<Backend[Method]>
>

/**
 * The options a caller of {@link backendQueryOptions} may add or override. They are the ones whose
 * types TanStack Query's core and vue-query agree on: a function-valued option (`enabled`,
 * `staleTime`, …) means a getter to vue-query, where the core passes it the query.
 */
export interface BackendQueryExtraOptions {
  /** Appended to the method's query key. */
  readonly queryKey?: QueryKey
  readonly enabled?: boolean
  readonly staleTime?: number
  readonly gcTime?: number
  readonly refetchInterval?: number | false
  readonly retry?: boolean | number
  readonly meta?: QueryMeta
}

/** The options {@link backendQueryOptions} returns. */
export interface BackendQueryOptions<TData> extends Omit<BackendQueryExtraOptions, 'queryKey'> {
  readonly queryKey: DataTag<QueryKey, TData, Error>
  readonly queryFn: () => Promise<TData>
  readonly networkMode: NetworkMode
  readonly staleTime: number
  readonly meta: QueryMeta
}

/**
 * The options every query of the given method gets, whichever framework runs it: its network
 * mode, stale time and persistence.
 */
export function backendQueryDefaults(backend: Backend | null, method: BackendQueryMethod) {
  return {
    ...backendBaseOptions(backend),
    staleTime: STALE_TIME_MAP[method] ?? 0,
    meta: { persist: PERSISTENCE_MAP[method] ?? true },
  }
}

export function backendQueryOptions<Method extends BackendQueryMethod>(
  backend: Backend,
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
  options?: BackendQueryExtraOptions,
): BackendQueryOptions<BackendMethodResult<Method>>
export function backendQueryOptions<Method extends BackendQueryMethod>(
  backend: Backend | null,
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
  options?: BackendQueryExtraOptions,
): BackendQueryOptions<BackendMethodResult<Method> | undefined>
/**
 * Query options for a call of a backend method, for vue-query and direct `QueryClient` calls alike.
 * The key is `[backendType, method, ...args, ...options.queryKey]`.
 */
export function backendQueryOptions<Method extends BackendQueryMethod>(
  backend: Backend | null,
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
  options?: BackendQueryExtraOptions,
): BackendQueryOptions<BackendMethodResult<Method> | undefined> {
  const defaults = backendQueryDefaults(backend, method)
  const queryKey: QueryKey = backendQueryKey(backend, method, args, options?.queryKey)
  return {
    ...options,
    networkMode: defaults.networkMode,
    // This is SAFE: it is the key this method's data is cached under. vue-query's `queryOptions`
    // tags the key the same way.
    queryKey: queryKey as DataTag<QueryKey, BackendMethodResult<Method> | undefined, Error>,
    staleTime: options?.staleTime ?? defaults.staleTime,
    meta: {
      ...options?.meta,
      persist: PERSISTENCE_MAP[method] ?? options?.meta?.persist ?? defaults.meta.persist,
    },
    queryFn: () => callBackendMethod(backend, method, args),
  }
}

/** Call a backend method by name. Without a backend, the result is `undefined`. */
export function callBackendMethod<Method extends BackendMethods>(
  backend: Backend | null,
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
): Promise<BackendMethodResult<Method>> {
  // The method is looked up by name, which TypeScript cannot follow through to its parameters.
  return (backend?.[method] as any)?.apply(backend, args)
}

/** The type of the corresponding mutation for the given backend method. */
export type BackendMutation<Method extends BackendMutationMethod> = Mutation<
  BackendMethodResult<Method>,
  Error,
  Parameters<Backend[Method]>
>

/** The options a caller of {@link backendMutationOptions} may add or override. */
export type BackendMutationExtraOptions<Method extends BackendMutationMethod, TData> = Omit<
  MutationOptions<TData, Error, Parameters<Backend[Method]>>,
  'mutationFn'
> & {
  /** `false` turns off all invalidations, the method's ({@link INVALIDATION_MAP}) included. */
  readonly invalidate?: boolean | undefined
}

export function backendMutationOptions<Method extends BackendMutationMethod>(
  backend: Backend,
  method: Method,
  options?: BackendMutationExtraOptions<Method, BackendMethodResult<Method>>,
): MutationOptions<BackendMethodResult<Method>, Error, Parameters<Backend[Method]>>
export function backendMutationOptions<Method extends BackendMutationMethod>(
  backend: Backend | null,
  method: Method,
  options?: BackendMutationExtraOptions<Method, BackendMethodResult<Method> | undefined>,
): MutationOptions<BackendMethodResult<Method> | undefined, Error, Parameters<Backend[Method]>>
/**
 * Mutation options for a call of a backend method, for vue-query and direct `QueryClient` calls
 * alike.
 * The mutation invalidates the queries in `options.meta.invalidates` and those
 * {@link INVALIDATION_MAP} lists for the method, and by default waits for them to be refetched.
 */
export function backendMutationOptions<Method extends BackendMutationMethod>(
  backend: Backend | null,
  method: Method,
  options?: BackendMutationExtraOptions<Method, BackendMethodResult<Method> | undefined>,
): MutationOptions<BackendMethodResult<Method> | undefined, Error, Parameters<Backend[Method]>> {
  const { invalidate, ...rest } = options ?? {}
  const invalidates =
    invalidate === false ?
      []
    : [
        ...(rest.meta?.invalidates ?? []),
        ...(INVALIDATION_MAP[method]?.map((queryMethod) =>
          queryMethod === INVALIDATE_ALL_QUERIES ? [backend?.type] : [backend?.type, queryMethod],
        ) ?? []),
      ]
  return {
    ...rest,
    mutationKey: [backend?.type, method, ...(rest.mutationKey ?? [])],
    mutationFn: (args) => callBackendMethod(backend, method, args),
    networkMode: backendBaseOptions(backend).networkMode,
    meta: {
      ...rest.meta,
      invalidates,
      awaitInvalidates: rest.meta?.awaitInvalidates ?? true,
      refetchType:
        rest.meta?.refetchType ??
        (invalidates.some((key) => key[1] === 'listDirectory') ? 'all' : 'active'),
    },
  }
}

/**
 * Run a mutation through the query client's mutation cache, from outside any component. It is
 * seen by `useMutationState`, and invalidates its queries, as a mutation from `useMutation` is.
 */
export function executeMutation<TData, TError, TVariables, TContext>(
  queryClient: QueryClient,
  options: MutationOptions<TData, TError, TVariables, TContext>,
  variables: TVariables,
): Promise<TData> {
  return queryClient.getMutationCache().build(queryClient, options).execute(variables)
}

/** Returns the QueryKey to use for the given backend method invocation. */
export function backendQueryKey<
  Method extends BackendMethods,
  TQueryKey extends readonly unknown[] = readonly unknown[],
>(
  backend: Backend | null,
  method: Method,
  args: Readonly<Parameters<Backend[Method]>>,
  keyExtra?: TQueryKey | undefined,
) {
  return [backend?.type, method, ...normalizeMethodQuery(method, args), ...(keyExtra ?? [])]
}

/** Returns options applicable to any method of the given backend. */
export function backendBaseOptions(backend: Backend | null): {
  networkMode: NetworkMode
} {
  return {
    networkMode: backend?.type === backendModule.BackendType.local ? 'always' : 'online',
  }
}
