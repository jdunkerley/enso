/**
 * @file Framework-free query options for the drive (#92, #192): its directory listings and
 * searches, and reading an asset back from the query cache, plus the names the drive gives new
 * assets. Every caller shares one `QueryClient` and these keys, so all read the same cached
 * listings.
 */
import type { Category, CategoryType } from '$/providers/category'
import { backendQueryOptions } from '$/utils/backendQuery'
import type { QueryClient, QueryFunctionContext, QueryKey } from '@tanstack/query-core'
import type { Backend } from 'enso-common/src/services/Backend'
import * as backendModule from 'enso-common/src/services/Backend'
import {
  FilterBy,
  type AnyAsset,
  type AssetId,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { z } from 'zod'

/** The listing filter of each category. */
export const CATEGORY_TO_FILTER_BY: Readonly<Record<CategoryType, FilterBy | null>> = {
  cloud: FilterBy.active,
  local: FilterBy.active,
  recent: null,
  trash: FilterBy.trashed,
  team: FilterBy.active,
  localDirectory: FilterBy.active,
}

/** Options for {@link listDirectoryQueryOptions}. */
export interface ListDirectoryQueryOptions {
  readonly backend: Backend
  readonly filterBy?: FilterBy | null | undefined
  readonly parentId: DirectoryId | null
  readonly category: Category
  readonly labels: readonly backendModule.LabelName[] | null
  readonly sortExpression: backendModule.AssetSortExpression | null
  readonly sortDirection: backendModule.AssetSortDirection | null
  /**
   * {@link listDirectoryRefetchInterval} gives it from the feature flags (in the drive,
   * `useListDirectoryRefetchInterval`, `#/layouts/Drive/driveActions`).
   * `undefined` is intentionally excluded as this value should be explicitly given.
   */
  readonly refetchInterval: number | null
  readonly infinite?: boolean
}

/** Build a query options object to fetch the children of a directory. */
export function listDirectoryQueryOptions(options: ListDirectoryQueryOptions) {
  const {
    backend,
    parentId,
    category,
    refetchInterval,
    labels,
    sortExpression,
    sortDirection,
    filterBy = CATEGORY_TO_FILTER_BY[category.type],
    infinite = false,
  } = options
  const rootPath = 'path' in category ? category.path : undefined
  return {
    meta: { persist: false },
    queryKey: [
      backend.type,
      'listDirectory',
      parentId,
      {
        rootPath,
        labels,
        sortExpression,
        sortDirection,
        filterBy,
        recentProjects: category.type === 'recent',
        infinite,
      },
    ],
    ...(refetchInterval != null ? { refetchInterval } : {}),
    queryFn: async (
      _context: QueryFunctionContext,
      { from, pageSize }: Pick<backendModule.ListDirectoryRequestParams, 'from' | 'pageSize'> = {
        from: null,
        pageSize: null,
      },
    ) => {
      try {
        return await backend.listDirectory(
          {
            parentId,
            rootPath,
            labels,
            sortExpression,
            sortDirection,
            filterBy,
            recentProjects: category.type === 'recent',
            from: from ?? null,
            pageSize: pageSize ?? null,
          },
          parentId ?? '(unknown)',
        )
      } catch (error) {
        if (error instanceof Error) {
          throw Object.assign(error, { parentId })
        } else {
          throw error
        }
      }
    },
  }
}

/** Options for {@link unsafe_assetFromCacheQueryOptions}. */
export interface AssetFromCacheQueryOptions {
  readonly backend: Backend
  readonly assetId: AssetId
  readonly queryClient: Pick<QueryClient, 'getQueryCache'>
}

/**
 * Build a query options object to fetch an asset from the query cache.
 * This is _only_ for situations when WE KNOW that the asset is in the cache.
 * This is _not_ a general purpose function for fetching assets.
 */
// eslint-disable-next-line camelcase
export function unsafe_assetFromCacheQueryOptions(options: AssetFromCacheQueryOptions) {
  const { backend, assetId, queryClient } = options

  const assetSchema = z
    .object({ id: z.string().refine((value) => value === assetId) })
    // This is safe, because we assert that the id is the same as the assetId
    // This makes us sure that this is an asset.
    .transform((data) => data as unknown as backendModule.AnyAsset)

  return {
    queryKey: [backend.type, 'asset', { id: assetId }],
    // We don't want to cache this query, as it's purely a computed from another query.
    gcTime: 0,
    meta: { persist: false },
    queryFn: () =>
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => {
          let data = query.state.data
          // Some queries store assets in infinite queries
          if (
            typeof data === 'object' &&
            data != null &&
            'pages' in data &&
            Array.isArray(data.pages)
          ) {
            data = data.pages.flatMap((page: unknown) =>
              typeof page === 'object' && page != null && 'assets' in page ? page.assets : [],
            )
          }
          // Some queries store assets arrays
          if (Array.isArray(data)) {
            const asset = data.find((maybeAsset) => assetSchema.safeParse(maybeAsset).success) as
              AnyAsset | undefined
            if (asset != null) return asset
          }
          // And sometimes we store them directly
          const result = assetSchema.safeParse(data)
          if (result.success) return data as AnyAsset | undefined
          return null
        })
        .filter((asset) => asset != null)[0],
  }
}

/** Options for {@link searchDirectoryQueryOptions}. */
export interface SearchDirectoryQueryOptions {
  readonly backend: Backend
  readonly parentId: DirectoryId | null
  readonly query: string | null
  readonly title: string | null
  readonly description: string | null
  readonly type: string | null
  readonly extension: string | null
  readonly labels: readonly backendModule.LabelName[] | null
  readonly sortExpression: backendModule.AssetSortExpression | null
  readonly sortDirection: backendModule.AssetSortDirection | null
  readonly infinite?: boolean
}

/** Build a query options object to search the descendants of a directory. */
export function searchDirectoryQueryOptions(options: SearchDirectoryQueryOptions) {
  const { backend, infinite = false, ...rest } = options
  const queryKey: QueryKey = [backend.type, 'searchDirectory', { ...rest, infinite }]
  return {
    // Even though the default stale time is 0, we want to ensure that the query is not cached.
    staleTime: 0,
    meta: { persist: false },
    queryKey,
    queryFn: (
      _context: QueryFunctionContext,
      { from, pageSize }: Pick<backendModule.SearchDirectoryRequestParams, 'from' | 'pageSize'> = {
        from: null,
        pageSize: null,
      },
    ) => backend.searchDirectory({ ...rest, from, pageSize }),
  }
}

/** The refetch interval of the drive's listings: the background refresh's, when it is on. */
export function listDirectoryRefetchInterval(
  enableBackgroundRefresh: boolean,
  backgroundRefreshInterval: number,
) {
  return enableBackgroundRefresh ? backgroundRefreshInterval : Infinity
}

/**
 * Query options for the children of a directory in a category, as the drive's actions (new folder,
 * new project, uploads) read them to choose new names.
 */
export function categoryListDirectoryQueryOptions(
  backend: Backend,
  category: CategoryType,
  parentId: DirectoryId,
) {
  return backendQueryOptions(backend, 'listDirectory', [
    {
      parentId,
      labels: null,
      filterBy: CATEGORY_TO_FILTER_BY[category],
      recentProjects: category === 'recent',
      sortExpression: null,
      sortDirection: null,
      from: null,
      pageSize: null,
    },
    '(unknown)',
  ])
}

/** The children of a directory in a category, from the cache if they are there. */
export async function ensureListDirectory(
  queryClient: QueryClient,
  backend: Backend,
  category: CategoryType,
  parentId: DirectoryId,
): Promise<readonly AnyAsset[]> {
  return (
    await queryClient.ensureQueryData(
      categoryListDirectoryQueryOptions(backend, category, parentId),
    )
  ).assets
}

/** All the items in a directory of the trash, from the cache if they are there. */
export async function getAllTrashedItems(
  queryClient: QueryClient,
  backend: Backend,
  parentId: DirectoryId | null,
): Promise<readonly AnyAsset[]> {
  return (
    await queryClient.ensureQueryData(
      backendQueryOptions(backend, 'listDirectory', [
        {
          parentId,
          labels: null,
          filterBy: FilterBy.trashed,
          recentProjects: false,
          from: null,
          pageSize: null,
          sortExpression: null,
          sortDirection: null,
        },
        '(unknown)',
      ]),
    )
  ).assets
}

/** The title of a new folder among the given siblings: "New Folder N", N one above the highest. */
export function newFolderTitle(siblings: readonly AnyAsset[]) {
  const directoryIndices = siblings
    .filter(backendModule.assetIsDirectory)
    .map((item) => /^New Folder (?<directoryIndex>\d+)$/.exec(item.title))
    .map((match) => match?.groups?.directoryIndex)
    .map((maybeIndex) => (maybeIndex != null ? parseInt(maybeIndex, 10) : 0))
  return `New Folder ${Math.max(0, ...directoryIndices) + 1}`
}

/**
 * The name of a new project among the given siblings: "<template or New Project> N", N one above
 * the highest.
 */
export function newProjectName(
  siblings: readonly AnyAsset[],
  templateName: string | null | undefined,
) {
  const prefix = `${templateName ?? 'New Project'} `
  const projectNameTemplate = new RegExp(`^${prefix}(?<projectIndex>\\d+)$`)
  const projectIndices = siblings
    .filter(backendModule.assetIsProject)
    .map((item) => projectNameTemplate.exec(item.title)?.groups?.projectIndex)
    .map((maybeIndex) => (maybeIndex != null ? parseInt(maybeIndex, 10) : 0))
  return `${prefix}${Math.max(0, ...projectIndices) + 1}`
}

/** The variables of the `updateAsset` mutation that renames an asset. */
export function renameAssetVariables(
  assetId: AssetId,
  newTitle: string,
  metadataId?: backendModule.MetadataId,
): Parameters<Backend['updateAsset']> {
  return [
    assetId,
    { title: newTitle, parentDirectoryId: null, description: null, metadataId: metadataId ?? null },
    assetId,
  ]
}
