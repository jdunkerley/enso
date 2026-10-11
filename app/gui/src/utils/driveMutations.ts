/**
 * @file Framework-free options for the drive's batched mutations: deleting, restoring, copying,
 * moving and downloading several assets at once (#192). vue-query and `executeMutation`
 * (`$/utils/backendQuery`) run the same mutations, with the same keys and invalidations, so
 * `useMutationState` sees them whichever started them.
 */
import type {
  ResolveDuplicationsOptions,
  ResolvedDuplication,
} from '$/components/Drive/duplicateAssets'
import type { MutationOptions } from '@tanstack/query-core'
import {
  BackendType,
  DuplicateAssetError,
  type AnyAsset,
  type AssetId,
  type Backend,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'

/** Asks the user how to resolve name conflicts. `resolveDuplications` asks through a dialog. */
export type DuplicationResolver = (
  options: ResolveDuplicationsOptions,
) => Promise<readonly ResolvedDuplication[]>

/** Throw the batch's failures, if there are any, as one error carrying them all and their count. */
function throwIfAnyFailed(results: readonly PromiseSettledResult<unknown>[], total: number) {
  const errors = results.flatMap((result): unknown[] =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (errors.length !== 0) {
    throw Object.assign(new Error(errors.map(getMessageOrToString).join('\n')), {
      errors,
      failed: errors.length,
      total,
    })
  }
}

/** The values of the fulfilled results. */
function fulfilledValues<T>(results: readonly PromiseSettledResult<T>[]) {
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

/** Type the options of a mutation, as vue-query's `mutationOptions` does. */
function defineMutationOptions<TData, TVariables>(
  options: MutationOptions<TData, Error, TVariables>,
) {
  return options
}

export const DELETE_ASSETS_MUTATION_METHOD = 'deleteAssets'

/** A key for {@link deleteAssetsMutationOptions}. */
export function deleteAssetsMutationKey(backendType: BackendType | null) {
  return [backendType, DELETE_ASSETS_MUTATION_METHOD]
}

/** The variables of {@link deleteAssetsMutationOptions}. */
export type DeleteAssetsVariables = readonly [ids: readonly AssetId[], force: boolean]

/** Call "delete" mutations for a list of assets. */
export function deleteAssetsMutationOptions(backend: Backend | null) {
  return defineMutationOptions({
    mutationKey: deleteAssetsMutationKey(backend?.type ?? null),
    mutationFn: async ([ids, force]: DeleteAssetsVariables) => {
      if (backend == null) throw Error('Backend unavailable')
      const results = await Promise.allSettled(
        ids.map((id) => backend.deleteAsset(id, { force }, '(unknown)')),
      )
      throwIfAnyFailed(results, ids.length)
      return null
    },
    meta: {
      invalidates: [
        [backend?.type, 'listDirectory'],
        [backend?.type, 'getAssetDetails'],
        [backend?.type, 'listAssetVersions'],
      ],
      awaitInvalidates: true,
      refetchType: 'all',
    },
  })
}

export const RESTORE_ASSETS_MUTATION_METHOD = 'restoreAssets'

/** A key for {@link restoreAssetsMutationOptions}. */
export function restoreAssetsMutationKey(backendType: BackendType) {
  return [backendType, RESTORE_ASSETS_MUTATION_METHOD]
}

/** The variables of {@link restoreAssetsMutationOptions}. */
export interface RestoreAssetsVariables {
  readonly ids: readonly AssetId[]
  readonly parentId: DirectoryId | null
}

/** Call "restore" mutations for a list of assets. */
export function restoreAssetsMutationOptions(backend: Backend) {
  return defineMutationOptions({
    mutationKey: restoreAssetsMutationKey(backend.type),
    mutationFn: async ({ ids, parentId = null }: RestoreAssetsVariables) => {
      const results = await Promise.allSettled(
        ids.map((id) => backend.undoDeleteAsset(id, parentId)),
      )
      throwIfAnyFailed(results, ids.length)
      return null
    },
    meta: {
      invalidates: [
        [backend.type, 'listDirectory'],
        [backend.type, 'getAssetDetails'],
      ],
      awaitInvalidates: true,
      refetchType: 'all',
    },
  })
}

export const COPY_ASSETS_MUTATION_METHOD = 'copyAssets'

/** A key for {@link copyAssetsMutationOptions}. */
export function copyAssetsMutationKey(backendType: BackendType | null) {
  return [backendType, COPY_ASSETS_MUTATION_METHOD]
}

/** The variables of {@link copyAssetsMutationOptions} and {@link moveAssetsMutationOptions}. */
export type TransferAssetsVariables = readonly [ids: readonly AssetId[], parentId: DirectoryId]

/** Call "copy" mutations for a list of assets. */
export function copyAssetsMutationOptions(backend: Backend | null) {
  return defineMutationOptions({
    mutationKey: copyAssetsMutationKey(backend?.type ?? null),
    mutationFn: async ([ids, parentId]: TransferAssetsVariables) => {
      const results = await Promise.allSettled(
        ids.map(async (id) => backend?.copyAsset(id, parentId)),
      )
      throwIfAnyFailed(results, ids.length)
      return fulfilledValues(results)
    },
    meta: {
      invalidates: [
        [backend?.type, 'listDirectory'],
        [backend?.type, 'getAssetDetails'],
      ],
      awaitInvalidates: true,
      refetchType: 'all',
    },
  })
}

export const MOVE_ASSETS_MUTATION_METHOD = 'moveAssets'

/** A key for {@link moveAssetsMutationOptions}. */
export function moveAssetsMutationKey(backendType: BackendType | null) {
  return [backendType, MOVE_ASSETS_MUTATION_METHOD]
}

/**
 * Call "move" mutations for a list of assets. An asset whose name is taken in the target directory
 * is not moved; `resolveDuplications` asks the user what to do about all of them, and the ones to
 * rename are moved under their new names.
 */
export function moveAssetsMutationOptions(
  backend: Backend | null,
  resolveDuplications: DuplicationResolver,
) {
  return defineMutationOptions({
    mutationKey: moveAssetsMutationKey(backend?.type ?? null),
    mutationFn: async ([ids, parentId]: TransferAssetsVariables) => {
      if (backend == null) throw Error('No backend available')
      const results = await Promise.allSettled(
        ids.map((id) =>
          backend
            .updateAsset(
              id,
              { description: null, parentDirectoryId: parentId, title: null, metadataId: null },
              '(unknown)',
            )
            .catch((error: unknown) => {
              if (error instanceof DuplicateAssetError) {
                return { id, error }
              }
              throw error
            }),
        ),
      )

      const duplicateErrors = fulfilledValues(results).flatMap((value) =>
        typeof value === 'object' && 'error' in value ? [value] : [],
      )

      if (duplicateErrors.length !== 0) {
        const resolutions = await resolveDuplications({
          targetId: parentId,
          conflictingIds: duplicateErrors.map((error) => error.id),
        })

        const renames = resolutions.filter((resolution) => resolution.conclusion === 'rename')

        await Promise.allSettled(
          renames.map((resolution) =>
            backend.updateAsset(
              resolution.assetId,
              {
                parentDirectoryId: parentId,
                description: null,
                title: resolution.newName,
                metadataId: null,
              },
              resolution.newName,
            ),
          ),
        )
      }

      throwIfAnyFailed(results, ids.length)
      return fulfilledValues(results)
    },
    meta: {
      invalidates: [
        [backend?.type, 'listDirectory'],
        [backend?.type, 'listAssetVersions'],
      ],
      awaitInvalidates: true,
    },
  })
}

/** The variables of {@link downloadAssetsMutationOptions}. */
export interface DownloadAssetsVariables {
  readonly ids: readonly Pick<AnyAsset, 'id' | 'title'>[]
  readonly targetDirectoryId: DirectoryId | null
  readonly shouldUnpackProject?: boolean
}

/** Call "download" mutations for a list of assets, one after the other. */
export function downloadAssetsMutationOptions(backend: Backend) {
  return defineMutationOptions({
    mutationKey: [backend.type, 'downloadAssets'],
    mutationFn: async (options: DownloadAssetsVariables) => {
      const { ids, targetDirectoryId, shouldUnpackProject } = options

      // Downloading assets should be done in order, because we want to avoid potential
      // race conditions.
      const rejects = []
      for (const { id, title } of ids) {
        try {
          await backend.download(id, title, targetDirectoryId, shouldUnpackProject)
        } catch (error) {
          rejects.push(error)
        }
      }

      if (rejects.length !== 0) {
        throw Object.assign(new Error(rejects.map(getMessageOrToString).join('\n')), {
          errors: rejects,
          failed: rejects.length,
          total: ids.length,
        })
      }

      return null
    },
    meta: {
      invalidates: [
        [BackendType.remote, 'listDirectory'],
        [BackendType.local, 'listDirectory'],
      ],
      awaitInvalidates: true,
    },
  })
}
