/**
 * @file Moving or copying assets between drive categories, from the React drive: the
 * framework-free `transferBetweenCategories` (`$/utils/transferBetweenCategories`) with the app's
 * stores, as the Vue `useTransferBetweenCategories` (`$/composables/transferBetweenCategories`)
 * gives it them. Goes with the React drive (#91).
 */
import { useUploadFileToCloud } from '#/hooks/backendUploadFilesHooks'
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { toast } from '#/utilities/toast'
import { askToCopyInstead } from '$/components/Drive/copyInstead'
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import type { Category } from '$/providers/category'
import { useBackends, useCategories, useText, useUser } from '$/providers/react'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { transferBetweenCategories, type TransferMethod } from '$/utils/transferBetweenCategories'
import { useQueryClient } from '@tanstack/react-query'
import type { DirectoryId } from 'enso-common/src/services/Backend'

/** A signature of function returned from {@link useTransferBetweenCategories}. */
export type TransferBetweenCategoriesFunction = ReturnType<typeof useTransferBetweenCategories>

/** A function to transfer a list of assets between categories. */
export function useTransferBetweenCategories() {
  const queryClient = useQueryClient()
  const { localBackend, remoteBackend } = useBackends()
  const { rootDirectoryId } = useUser()
  const { categoryDirectoryId, getCategoryByDirectoryId, categoryLabel } = useCategories()
  const { getText } = useText()
  const uploadToCloud = useUploadFileToCloud()

  return useEventCallback(
    (
      from: Category,
      to: Category,
      assets: Iterable<TransferrableAsset>,
      newParentId: DirectoryId | null = null,
      method: TransferMethod = 'move',
    ) =>
      transferBetweenCategories(
        {
          queryClient,
          localBackend,
          remoteBackend,
          rootDirectoryId,
          categoryDirectoryId,
          getCategoryByDirectoryId,
          categoryLabel,
          getText,
          resolveDuplications,
          askToCopyInstead,
          uploadToCloud,
          toastPromise: (promise, messages) => toast.promise(promise, messages),
        },
        from,
        to,
        assets,
        newParentId,
        method,
      ),
  )
}
