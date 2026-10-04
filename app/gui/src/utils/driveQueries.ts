/**
 * @file Framework-free options for the drive's directory listings, and for reading an asset back
 * from the query cache. Moved out of the React `#/hooks/backendHooks` (#92) so that the Vue
 * modals share them, with the same keys: the React and Vue sides share one `QueryClient`, so both
 * read the same cached listings.
 */
import type { Category, CategoryType } from '$/providers/category'
import type { QueryClient, QueryFunctionContext } from '@tanstack/query-core'
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
   * In React, `useListDirectoryRefetchInterval` (`#/hooks/backendHooks`) gives the correct value.
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
