/**
 * @file The drive's actions, for its Vue components: thin wrappers over the framework-free queries
 * and mutations (`$/utils/backendQuery`, `$/utils/driveQueries`, `$/utils/driveMutations`), the
 * uploads (`$/providers/upload`) and the transfer between categories, giving them the drive's
 * stores (#192, ruling 12). Call them in a component's `setup`; the functions they return may be
 * called at any time.
 */
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import { useTransferBetweenCategories } from '$/composables/transferBetweenCategories'
import {
  dropOperationBetweenCategories,
  type Category,
  type CategoryType,
} from '$/providers/category'
import { useContainerData } from '$/providers/container'
import type { DrivePastePayload, DriveStore } from '$/providers/driveStore'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useLocalPaths } from '$/providers/localDirectories'
import type { ProjectInfo } from '$/providers/openedProjects/projectInfo'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { uploadFiles, useUploadsToCloudStore } from '$/providers/upload'
import { backendMutationOptions, executeMutation } from '$/utils/backendQuery'
import {
  ensureListDirectory,
  listDirectoryRefetchInterval,
  newFolderTitle,
  newProjectName,
  renameAssetVariables,
} from '$/utils/driveQueries'
import type { MutationKey, MutationOptions } from '@tanstack/query-core'
import { useQueryClient } from '@tanstack/vue-query'
import { PRODUCT_NAME } from 'enso-common/src/constants'
import {
  AssetType,
  Path,
  type AnyAsset,
  type AssetId,
  type Backend,
  type DirectoryId,
  type MetadataId,
} from 'enso-common/src/services/Backend'
import type { TextId } from 'enso-common/src/text'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed, onScopeDispose, ref, toValue, type MaybeRefOrGetter } from 'vue'

/**
 * A function running a mutation through the mutation cache, so that the drive's rows see it in
 * flight (`usePendingMutations`).
 */
export function useMutationCallback<TData, TError, TVariables, TContext>(
  options: MaybeRefOrGetter<MutationOptions<TData, TError, TVariables, TContext>>,
) {
  const queryClient = useQueryClient()
  return (variables: TVariables) => executeMutation(queryClient, toValue(options), variables)
}

/**
 * A function showing an error toast whose text is the given text's (if any) and the error's
 * message, and logging the same message.
 */
export function useToastAndLog() {
  const { getText } = useText()
  const toasts = useToasts()
  return (textId: TextId | null, error?: unknown, ...replacements: readonly string[]) => {
    // The replacements are the text's.
    // eslint-disable-next-line no-restricted-syntax
    const getTextWithReplacements = getText as (id: TextId, ...args: readonly string[]) => string
    const prefix = textId == null ? null : getTextWithReplacements(textId, ...replacements)
    const message =
      error == null ?
        `${prefix ?? ''}.`
      : `${prefix != null ? prefix + ': ' : ''}${getMessageOrToString(error)}`
    const id = toasts.show(message, { type: 'error' })
    // Logged as well as shown.
    // eslint-disable-next-line no-restricted-properties
    console.error(message)
    return id
  }
}

/** The refetch interval of the drive's listings, from the feature flags. */
export function useListDirectoryRefetchInterval() {
  const enableBackgroundRefresh = useFeatureFlag('enableAssetsTableBackgroundRefresh')
  const backgroundRefreshInterval = useFeatureFlag('assetsTableBackgroundRefreshInterval')
  return computed(() =>
    listDirectoryRefetchInterval(enableBackgroundRefresh.value, backgroundRefreshInterval.value),
  )
}

/** A function to create a new folder, select it and start renaming it. */
export function useNewFolder(
  backend: MaybeRefOrGetter<Backend>,
  category: MaybeRefOrGetter<CategoryType>,
  driveStore: DriveStore,
) {
  const queryClient = useQueryClient()
  return async (parentId: DirectoryId) => {
    const backendValue = toValue(backend)
    const siblings = await ensureListDirectory(
      queryClient,
      backendValue,
      toValue(category),
      parentId,
    )
    const title = newFolderTitle(siblings)
    const result = await executeMutation(
      queryClient,
      backendMutationOptions(backendValue, 'createDirectory'),
      [{ parentId, title }],
    )
    driveStore.setAssetToRename(result.id)
    driveStore.setSelectedAssets([{ type: AssetType.directory, ...result }])
    return result
  }
}

/** A function to create a new project, and open it. */
export function useNewProject(
  backend: MaybeRefOrGetter<Backend>,
  category: MaybeRefOrGetter<CategoryType>,
) {
  const queryClient = useQueryClient()
  const container = useContainerData()
  return async (
    {
      templateName,
      ensoPath,
    }: {
      templateName?: string | null | undefined
      ensoPath?: string | null | undefined
    },
    parentId: DirectoryId,
  ) => {
    const backendValue = toValue(backend)
    const siblings = await ensureListDirectory(
      queryClient,
      backendValue,
      toValue(category),
      parentId,
    )
    const projectName = newProjectName(siblings, templateName)
    const createdProject = await executeMutation(
      queryClient,
      backendMutationOptions(backendValue, 'createProject'),
      [{ parentDirectoryId: parentId, projectName, ...(ensoPath == null ? {} : { ensoPath }) }],
    )
    const openProjectParams = {
      id: createdProject.projectId,
      parentId,
      title: createdProject.name,
      ensoPath: createdProject.ensoPath,
    } satisfies Omit<ProjectInfo, 'mode'>
    container.openProjectLocally(openProjectParams, backendValue.type)
    return createdProject
  }
}

/** A function to rename an asset. */
export function useRenameAsset(backend: MaybeRefOrGetter<Backend>) {
  const queryClient = useQueryClient()
  return (assetId: AssetId, newTitle: string, metadataId?: MetadataId) =>
    executeMutation(
      queryClient,
      backendMutationOptions(toValue(backend), 'updateAsset'),
      renameAssetVariables(assetId, newTitle, metadataId),
    )
}

/** A function to upload files into a directory, selecting them as they are uploaded. */
export function useUploadFiles(
  backend: MaybeRefOrGetter<Backend>,
  category: MaybeRefOrGetter<CategoryType>,
  driveStore: DriveStore,
) {
  const queryClient = useQueryClient()
  const uploads = useUploadsToCloudStore()
  return (filesToUpload: readonly File[], parentId: DirectoryId) =>
    uploadFiles(
      {
        queryClient,
        backend: toValue(backend),
        category: toValue(category),
        uploadToCloud: (file, params, kind) => uploads.uploadFile(file, params, kind),
        resolveDuplications,
        onUploaded: (uploaded) => driveStore.setSelectedAssets(uploaded),
      },
      filesToUpload,
      parentId,
    )
}

/** A function copying cloud assets to the local drive. */
export function useUploadFileToLocal(category: MaybeRefOrGetter<Category>) {
  const transferBetweenCategories = useTransferBetweenCategories()
  return async (assets: readonly AnyAsset[]) => {
    await transferBetweenCategories(toValue(category), { type: 'local' }, assets)
  }
}

/** Options for the function {@link usePaste} returns. */
export interface PasteOptions {
  readonly fromCategory: Category
  readonly toCategory: Category
  readonly newParentId: DirectoryId
  readonly pasteData: DrivePastePayload
  readonly method: 'copy' | 'move'
}

/**
 * A function copying or moving assets as appropriate. Assets are moved, except when cut and pasted
 * between the Team Space and the User Space, where they are copied.
 */
export function usePaste() {
  const transferBetweenCategories = useTransferBetweenCategories()
  return (options: PasteOptions) => {
    const { newParentId, pasteData, fromCategory, toCategory, method } = options
    const dropOperation = dropOperationBetweenCategories(fromCategory, toCategory, newParentId)
    if (dropOperation === 'cancel') return
    return transferBetweenCategories(
      fromCategory,
      toCategory,
      pasteData.assets,
      newParentId,
      method,
    )
  }
}

/** A function exporting the selected assets as an archive. */
export function useExportArchive(backend: MaybeRefOrGetter<Backend>, driveStore: DriveStore) {
  const { getText } = useText()
  const toasts = useToasts()
  const localPaths = useLocalPaths()
  const queryClient = useQueryClient()

  return async () => {
    const { selectedIds } = driveStore.state
    const secondsString = new Date().getSeconds().toString().padStart(2, '0')
    const dateString = `${toReadableIsoString(new Date()).replace(/[:]/g, ' ')} ${secondsString}`
    const [filePathRaw] =
      (await window.api?.fileBrowser.openFileBrowser(
        'filePath',
        `${localPaths.downloadDirectory}/${PRODUCT_NAME} ${dateString}.zip`,
      )) ?? []
    if (window.api && filePathRaw == null) {
      // Assume that the user cancelled the action.
      return
    }
    // If the file path is null, assume the user is using the desktop app's server with a browser.
    // The desktop app's server will return a stream instead that can be downloaded by the browser.
    const filePath = filePathRaw != null ? Path(filePathRaw) : null
    await toasts.promise(
      executeMutation(queryClient, backendMutationOptions(toValue(backend), 'exportArchive'), [
        { assetIds: [...selectedIds], filePath },
      ]),
      {
        pending: getText('exportArchive.inProgress'),
        success: getText('exportArchive.success'),
        error: getText('exportArchive.failure'),
      },
    )
  }
}

/**
 * The pending mutations with the given key (matched as a prefix), kept up to date: the drive's rows
 * fade while they are deleted, restored, renamed or moved.
 */
export function usePendingMutations(mutationKey: () => MutationKey) {
  const mutationCache = useQueryClient().getMutationCache()
  const version = ref(0)
  onScopeDispose(mutationCache.subscribe(() => (version.value += 1)))
  return computed(() => {
    void version.value
    return mutationCache.findAll({ mutationKey: mutationKey(), status: 'pending' })
  })
}
