/** @file Moving or copying assets between the local drive's folders, with the app's stores. */
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import { useBackends } from '$/providers/backends'
import { dropOperationBetweenCategories, useCategories, type Category } from '$/providers/category'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { executeMutation } from '$/utils/backendQuery'
import { copyAssetsMutationOptions, moveAssetsMutationOptions } from '$/utils/driveMutations'
import { useQueryClient } from '@tanstack/vue-query'
import type { DirectoryId } from 'enso-common/src/services/Backend'

/**
 * Return a function that moves or copies assets from one category to another, into `newParentId`
 * or else the target category's root. Dropping into the same folder, or from or into Recent, does
 * nothing. Call it in a component's `setup`; the function it returns may be called at any time.
 */
export function useMoveAssets() {
  const queryClient = useQueryClient()
  const backends = useBackends()
  const categories = useCategories()
  return async (
    from: Category,
    to: Category,
    assets: Iterable<TransferrableAsset>,
    newParentId: DirectoryId | null = null,
    method: 'copy' | 'move' = 'move',
  ): Promise<unknown> => {
    if (dropOperationBetweenCategories(from, to, newParentId) === 'cancel') return
    const target = newParentId ?? categories.categoryDirectoryId(to)
    const { localBackend } = backends
    if (target == null || localBackend == null) return
    const ids = Array.from(assets, (asset) => asset.id)
    return method === 'copy' ?
        executeMutation(queryClient, copyAssetsMutationOptions(localBackend), [ids, target])
      : executeMutation(queryClient, moveAssetsMutationOptions(localBackend, resolveDuplications), [
          ids,
          target,
        ])
  }
}
