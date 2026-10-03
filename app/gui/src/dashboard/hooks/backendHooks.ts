/**
 * @file The React drive's hooks over the framework-free backend query and mutation options
 * (`$/utils/backendQuery`, `$/utils/driveQueries`). They hold no options of their own, and go with
 * the React drive (#91).
 */
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { useSetAssetToRename, useSetSelectedAssets } from '#/providers/DriveProvider'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import type { CategoryType } from '$/providers/category'
import type { ProjectInfo } from '$/providers/openedProjects/projectInfo'
import { useContainerData } from '$/providers/react/container'
import { useFeatureFlag } from '$/providers/react/featureFlags'
import {
  backendMutationOptions,
  type BackendMutation,
  type BackendMutationMethod,
} from '$/utils/backendQuery'
import {
  ensureListDirectory,
  listDirectoryRefetchInterval,
  newFolderTitle,
  newProjectName,
  renameAssetVariables,
} from '$/utils/driveQueries'
import {
  useMutationState,
  useQueryClient,
  type Mutation,
  type MutationKey,
} from '@tanstack/react-query'
import type * as backendModule from 'enso-common/src/services/Backend'
import type { Backend } from 'enso-common/src/services/Backend'
import { AssetType, type AssetId, type DirectoryId } from 'enso-common/src/services/Backend'

/** Return the refetch interval for listing directories based on feature flag state. */
export function useListDirectoryRefetchInterval() {
  const enableAssetsTableBackgroundRefresh = useFeatureFlag('enableAssetsTableBackgroundRefresh')
  const assetsTableBackgroundRefreshInterval = useFeatureFlag(
    'assetsTableBackgroundRefreshInterval',
  )
  return listDirectoryRefetchInterval(
    enableAssetsTableBackgroundRefresh,
    assetsTableBackgroundRefreshInterval,
  )
}

/** Return matching in-flight mutations matching the given filters. */
export function useBackendMutationState<Method extends BackendMutationMethod, Result>(
  backend: Backend,
  method: Method,
  options: {
    mutationKey?: MutationKey
    predicate?: (mutation: BackendMutation<Method>) => boolean
    select?: (mutation: BackendMutation<Method>) => Result
  } = {},
) {
  const { mutationKey, predicate, select } = options
  return useMutationState({
    filters: {
      ...backendMutationOptions(backend, method, mutationKey ? { mutationKey } : {}),
      // We rely on mutation key pointing to properly typed mutation.
      // eslint-disable-next-line no-restricted-syntax
      predicate: ((mutation: BackendMutation<Method>) =>
        mutation.state.status === 'pending' && (predicate?.(mutation) ?? true)) as (
        mutation: Mutation,
      ) => boolean,
    },
    // This is UNSAFE when the `Result` parameter is explicitly specified in the
    // generic parameter list.
    // eslint-disable-next-line no-restricted-syntax
    select: select as (mutation: Mutation) => Result,
  })
}

/** Return query data for the children of a directory, fetching it if it does not exist. */
export function useEnsureListDirectory(backend: Backend, category: CategoryType) {
  const queryClient = useQueryClient()
  return useEventCallback((parentId: DirectoryId) =>
    ensureListDirectory(queryClient, backend, category, parentId),
  )
}

/** A function to create a new folder. */
export function useNewFolder(backend: Backend, category: CategoryType) {
  const ensureSiblings = useEnsureListDirectory(backend, category)
  const setNewestFolderId = useSetAssetToRename()
  const setSelectedAssets = useSetSelectedAssets()

  const createDirectory = useMutationCallback(backendMutationOptions(backend, 'createDirectory'))

  return useEventCallback(async (parentId: DirectoryId) => {
    const title = newFolderTitle(await ensureSiblings(parentId))
    return await createDirectory([{ parentId, title }]).then((result) => {
      setNewestFolderId(result.id)
      setSelectedAssets([{ type: AssetType.directory, ...result }])
      return result
    })
  })
}

/** A function to create a new project. */
export function useNewProject(backend: Backend, category: CategoryType) {
  const ensureSiblings = useEnsureListDirectory(backend, category)
  const { openProjectLocally } = useContainerData()

  const createProject = useMutationCallback(backendMutationOptions(backend, 'createProject'))

  return useEventCallback(
    async (
      {
        templateName,
        ensoPath,
      }: {
        templateName?: string | null | undefined
        ensoPath?: string | null | undefined
      },
      parentId: DirectoryId,
    ) => {
      const projectName = newProjectName(await ensureSiblings(parentId), templateName)
      return await createProject([
        {
          parentDirectoryId: parentId,
          projectName,
          ...(ensoPath == null ? {} : { ensoPath }),
        },
      ]).then((createdProject) => {
        const openProjectParams = {
          id: createdProject.projectId,
          parentId: parentId,
          title: createdProject.name,
          ensoPath: createdProject.ensoPath,
        } satisfies Omit<ProjectInfo, 'mode'>
        openProjectLocally(openProjectParams, backend.type)
        return createdProject
      })
    },
  )
}

/** Return a function to rename an asset. */
export function useRenameAsset(backend: Backend) {
  const updateAsset = useMutationCallback(backendMutationOptions(backend, 'updateAsset'))

  return useEventCallback(
    (assetId: AssetId, newTitle: string, metadataId?: backendModule.MetadataId) =>
      updateAsset(renameAssetVariables(assetId, newTitle, metadataId)),
  )
}
