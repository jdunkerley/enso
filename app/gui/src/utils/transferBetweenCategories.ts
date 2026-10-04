/**
 * @file Moving or copying assets from one drive category to another: what dropping assets on a
 * category, or pasting them into one, does. Framework-free, moved out of the React
 * `#/layouts/Drive/Categories/transferBetweenCategoriesHooks` (#192): the Vue composable
 * (`$/composables/transferBetweenCategories`) and the React hook give it the app's stores, and the
 * mutations run through the shared query client, with the options in `$/utils/driveMutations`.
 */
import type { UploadFileToCloudOptions } from '$/cloud/uploadToCloud'
import {
  CATEGORY_BACKEND,
  categoryEq,
  dropOperationBetweenCategories,
  isCloudCategory,
  isLocalCategory,
  type Category,
} from '$/providers/category'
import type { Resolution } from '$/providers/modals'
import type { GetText } from '$/providers/text'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { executeMutation } from '$/utils/backendQuery'
import {
  copyAssetsMutationOptions,
  deleteAssetsMutationOptions,
  downloadAssetsMutationOptions,
  moveAssetsMutationOptions,
  restoreAssetsMutationOptions,
  type DuplicationResolver,
} from '$/utils/driveMutations'
import { parseDirectoriesPath } from '$/utils/parseDirectoriesPath'
import type { QueryClient } from '@tanstack/query-core'
import {
  BackendType,
  type AssetId,
  type Backend,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import invariant from 'tiny-invariant'

/** Whether assets are moved or copied; anything else does nothing. */
export type TransferMethod = 'copy' | 'move' | 'link' | 'cancel'

/** What {@link transferBetweenCategories} needs from the app. */
export interface TransferBetweenCategoriesContext {
  readonly queryClient: QueryClient
  readonly localBackend: LocalBackend | null
  readonly remoteBackend: Backend
  /** The signed-in user's root directory. */
  readonly rootDirectoryId: DirectoryId
  readonly categoryDirectoryId: (category: Category) => DirectoryId | null
  readonly getCategoryByDirectoryId: (directoryId: DirectoryId) => Category | undefined
  readonly categoryLabel: (category: Category) => string
  readonly getText: GetText
  readonly resolveDuplications: DuplicationResolver
  /** Ask whether to copy instead (`askToCopyInstead`, `$/components/Drive/copyInstead`). */
  readonly askToCopyInstead: (message: string, description: string) => Promise<Resolution>
  /** `uploadAssetsToCloud` (`$/cloud/uploadToCloud`), with its context. */
  readonly uploadToCloud: (
    localBackend: LocalBackend,
    options: UploadFileToCloudOptions,
  ) => Promise<unknown>
  /** Show a loading toast while the promise is pending, then its outcome. */
  readonly toastPromise: (
    promise: Promise<unknown>,
    messages: { readonly pending: string; readonly success: string; readonly error: string },
  ) => Promise<unknown>
}

/** The backend of each backend type. */
function backendOf(context: TransferBetweenCategoriesContext, type: BackendType) {
  return type === BackendType.local ? context.localBackend : context.remoteBackend
}

/** Copy assets into a directory, on the backend of the given type. */
function copyAssets(
  context: TransferBetweenCategoriesContext,
  type: BackendType,
  ids: readonly AssetId[],
  targetDirectoryId: DirectoryId,
) {
  return executeMutation(context.queryClient, copyAssetsMutationOptions(backendOf(context, type)), [
    ids,
    targetDirectoryId,
  ])
}

/** Move assets into a directory, on the backend of the given type. */
function moveAssets(
  context: TransferBetweenCategoriesContext,
  type: BackendType,
  ids: readonly AssetId[],
  targetDirectoryId: DirectoryId,
) {
  return executeMutation(
    context.queryClient,
    moveAssetsMutationOptions(backendOf(context, type), context.resolveDuplications),
    [ids, targetDirectoryId],
  )
}

/** Ask whether to copy assets that cannot be moved out of a team's folder. */
function askToCopyInsteadOfMoving(context: TransferBetweenCategoriesContext, from: Category) {
  const { getText, categoryLabel } = context
  return context.askToCopyInstead(
    getText('copyInsteadOfMoving', categoryLabel(from)),
    getText('youCanCopyInstead'),
  )
}

/**
 * Move or copy assets from one category to another, into `newParentId` or else the target
 * category's root. What happens depends on the two categories:
 * - between two cloud categories, the assets are moved or copied; moving out of a team's folder
 *   (to another team, or to the user's own folder) is not allowed, and the user is asked whether
 *   to copy them instead (cancelling does nothing);
 * - into the trash, they are deleted;
 * - from the cloud to a local category, they are downloaded (again asking to copy instead when
 *   they come from a team's folder);
 * - out of the trash, they are restored, except that assets of a team's folder cannot be restored
 *   into another category, and the user is asked whether to copy them instead;
 * - from a local category to the cloud, local projects are uploaded;
 * - within the local drive, they are moved or copied.
 */
export async function transferBetweenCategories(
  context: TransferBetweenCategoriesContext,
  from: Category,
  to: Category,
  assets: Iterable<TransferrableAsset>,
  newParentId: DirectoryId | null = null,
  method: TransferMethod = 'move',
): Promise<unknown> {
  const { getText, categoryLabel } = context
  const operation = dropOperationBetweenCategories(from, to, newParentId)
  if (operation === 'cancel') return
  if (to.type === 'recent') return
  const assetsArray = Array.from(assets)
  const keysArray = assetsArray.map((asset) => asset.id)

  const targetDirectoryId = newParentId ?? context.categoryDirectoryId(to)
  if (targetDirectoryId == null) return

  const baseMutation = () => {
    const type = CATEGORY_BACKEND[from.type]
    switch (method) {
      case 'copy':
        return copyAssets(context, type, keysArray, targetDirectoryId)
      case 'move':
        return moveAssets(context, type, keysArray, targetDirectoryId)
      default:
        return
    }
  }

  switch (from.type) {
    case 'team':
    case 'cloud': {
      // Moving out of a team's folder is not allowed: the user is asked to copy instead, and a
      // dismissed question does nothing (#200; React went on to attempt the move).
      if (from.type === 'team' && to.type === 'team' && !categoryEq(from, to)) {
        const resolution =
          method === 'move' ? await askToCopyInsteadOfMoving(context, from) : 'confirm'
        if (resolution === 'confirm') {
          await copyAssets(context, BackendType.remote, keysArray, targetDirectoryId)
        }
        return
      }

      if (to.type === 'trash') {
        await executeMutation(
          context.queryClient,
          deleteAssetsMutationOptions(context.remoteBackend),
          [keysArray, false],
        )
        return
      }

      if (isLocalCategory(to)) {
        if (from.type === 'team' && method === 'move') {
          const resolution = await askToCopyInsteadOfMoving(context, from)
          if (resolution !== 'confirm') {
            return
          }
        }

        await context.toastPromise(
          executeMutation(
            context.queryClient,
            downloadAssetsMutationOptions(context.remoteBackend),
            {
              ids: assetsArray,
              targetDirectoryId,
            },
          ),
          {
            pending: getText('downloadingProjectToLocal'),
            success: getText('downloadProjectToLocalSuccess'),
            error: getText('downloadProjectToLocalError'),
          },
        )
        return
      }

      if (from.type === 'team' && to.type === 'cloud') {
        const resolution =
          method === 'move' ? await askToCopyInsteadOfMoving(context, from) : 'confirm'
        if (resolution === 'confirm') {
          await copyAssets(context, BackendType.remote, keysArray, targetDirectoryId)
        }
        return
      }

      // Not awaited, as before: the drop is done once the mutation has started.
      void baseMutation()
      return
    }
    case 'trash': {
      if (to.type === 'trash') {
        return
      }
      if (isLocalCategory(to)) {
        return
      }

      const groups = groupTransferrableAssetsByCategory(context, assetsArray)
      const entries = Array.from(groups.entries())

      return Promise.all([
        ...entries
          .filter(([category]) => category.type === 'cloud')
          .map(([, assetsByCategory]) =>
            executeMutation(
              context.queryClient,
              restoreAssetsMutationOptions(context.remoteBackend),
              { ids: assetsByCategory.map((asset) => asset.id), parentId: targetDirectoryId },
            ),
          ),
        ...entries
          .filter(([category]) => category.type === 'team')
          .map(async ([category, assetsByCategory]) => {
            const resolution = await context.askToCopyInstead(
              getText('copyInsteadOfRestoring', categoryLabel(category), categoryLabel(to)),
              getText(
                'copyInsteadOfRestoringDescription',
                categoryLabel(category),
                categoryLabel(to),
              ),
            )
            if (resolution === 'confirm') {
              return copyAssets(
                context,
                BackendType.remote,
                assetsByCategory.map((asset) => asset.id),
                targetDirectoryId,
              )
            }
          }),
      ])
    }
    case 'local':
    case 'localDirectory': {
      const { localBackend } = context
      invariant(
        localBackend != null,
        'The Local backend must be present to transfer assets from or to the local category.',
      )
      if (isCloudCategory(to)) {
        return context.uploadToCloud(localBackend, { assets: assetsArray, targetDirectoryId })
      }
      void baseMutation()
      return
    }
    case 'recent': {
      return
    }
  }
}

/** Group assets by the category their path is in. Assets in no category are left out. */
function groupTransferrableAssetsByCategory(
  context: TransferBetweenCategoriesContext,
  assets: readonly TransferrableAsset[],
) {
  const groups = new Map<Category, TransferrableAsset[]>()

  for (const asset of assets) {
    const { category } = parseDirectoriesPath({
      parentsPath: asset.parentsPath,
      virtualParentsPath: asset.virtualParentsPath,
      rootDirectoryId: context.rootDirectoryId,
      getCategoryByDirectoryId: context.getCategoryByDirectoryId,
      categoryLabel: context.categoryLabel,
    })

    if (category == null) {
      continue
    }

    groups.set(category, [...(groups.get(category) ?? []), asset])
  }

  return groups
}
