/**
 * @file A hook returning the root directory id and expanded directory ids: a React adapter over
 * the Vue stores (`$/providers/category`, the drive location), which goes with the React drive
 * (#91).
 */
import { useStore } from '#/hooks/storeHooks'
import type { Category } from '$/providers/category'
import { localPathsStore } from '$/providers/localDirectories'
import { useCategories, useUser } from '$/providers/react'
import { useDriveCurrentDirectory } from '$/providers/react/container'

/** Options for {@link useDirectoryIds}. */
export interface UseDirectoryIdsOptions {
  readonly category: Category
}

/** A hook returning the root directory id and expanded directory ids. */
export function useDirectoryIds(options: UseDirectoryIdsOptions) {
  const { category } = options

  const { categoryDirectoryId } = useCategories()
  const user = useUser()
  // `categoryDirectoryId` reads Vue state, which React does not track: subscribing to the saved
  // root directory re-renders this hook when Settings changes it, so the Local category lists the
  // new root at once (#182). The id itself is computed during render, so it is never a render
  // behind a change of category.
  useStore(localPathsStore, (state) => state.localRootDirectory)
  const categoryHomeDir = categoryDirectoryId(category)

  const rootDirectoryId = categoryHomeDir ?? user.rootDirectoryId
  /** The id of the directory to use in the "list directory" query. */
  const queryDirectoryId = useDriveCurrentDirectory()[0] ?? categoryHomeDir
  const currentDirectoryId = queryDirectoryId ?? rootDirectoryId

  return {
    rootDirectoryId,
    queryDirectoryId,
    currentDirectoryId,
  } as const
}
