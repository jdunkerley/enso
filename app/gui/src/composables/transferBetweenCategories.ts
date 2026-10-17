/**
 * @file Moving or copying assets between drive categories, from Vue: the framework-free
 * `transferBetweenCategories` (`$/utils/transferBetweenCategories`) with the app's stores. Call it
 * in a component's `setup`; the function it returns may be called at any time.
 */
import { askToCopyInstead } from '$/components/Drive/copyInstead'
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useCategories, type Category } from '$/providers/category'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import {
  transferBetweenCategories,
  type TransferBetweenCategoriesContext,
  type TransferMethod,
} from '$/utils/transferBetweenCategories'
import { useQueryClient } from '@tanstack/vue-query'
import type { DirectoryId } from 'enso-common/src/services/Backend'
import invariant from 'tiny-invariant'

/** Return a function that moves or copies assets from one category to another. */
export function useTransferBetweenCategories() {
  const queryClient = useQueryClient()
  const backends = useBackends()
  const auth = useAuth()
  const categories = useCategories()
  const { getText } = useText()
  const toasts = useToasts()

  function context(): TransferBetweenCategoriesContext {
    const user = auth.session?.user
    invariant(user != null, 'Assets can only be transferred while signed in.')
    const { remoteBackend } = backends
    return {
      queryClient,
      localBackend: backends.localBackend,
      remoteBackend,
      rootDirectoryId: user.rootDirectoryId,
      categoryDirectoryId: categories.categoryDirectoryId,
      getCategoryByDirectoryId: categories.getCategoryByDirectoryId,
      categoryLabel: categories.categoryLabel,
      getText,
      resolveDuplications,
      askToCopyInstead,
      toastPromise: (promise, messages) => toasts.promise(promise, messages),
    }
  }

  return (
    from: Category,
    to: Category,
    assets: Iterable<TransferrableAsset>,
    newParentId?: DirectoryId | null,
    method?: TransferMethod,
  ) => transferBetweenCategories(context(), from, to, assets, newParentId, method)
}
