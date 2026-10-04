/**
 * @file The React drive's hooks for uploading: thin adapters over the framework-free
 * `uploadFiles` (`$/providers/upload`) and `uploadAssetsToCloud` (`$/cloud/uploadToCloud`), giving
 * them the React drive's stores. They go with the React drive (#91).
 */
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { useToastAndLog } from '#/hooks/toastAndLogHooks'
import { useTransferBetweenCategories } from '#/layouts/Drive/Categories'
import { useSetSelectedAssets } from '#/providers/DriveProvider'
import { toast } from '#/utilities/toast'
import { uploadAssetsToCloud, type UploadFileToCloudOptions } from '$/cloud/uploadToCloud'
import { resolveDuplications } from '$/components/Drive/duplicateAssets'
import type { Category, CategoryType } from '$/providers/category'
import { useBackends, useHttpClient, useText } from '$/providers/react'
import { useUploadsToCloudStore } from '$/providers/react/upload'
import { uploadFiles } from '$/providers/upload'
import { useQueryClient } from '@tanstack/react-query'
import type { AnyAsset, Backend, DirectoryId } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'

/** A function to upload files into a directory. */
export function useUploadFiles(backend: Backend, category: CategoryType) {
  const queryClient = useQueryClient()
  const uploads = useUploadsToCloudStore()
  const setSelectedAssets = useSetSelectedAssets()

  return useEventCallback((filesToUpload: readonly File[], parentId: DirectoryId) =>
    uploadFiles(
      {
        queryClient,
        backend,
        category,
        uploadToCloud: uploads.uploadFile.bind(uploads),
        resolveDuplications,
        onUploaded: setSelectedAssets,
      },
      filesToUpload,
      parentId,
    ),
  )
}

/**
 * Packs a project into a file and uploads it to the cloud.
 * Does not work in environments that do not have a local backend.
 */
export function useUploadFileToCloud() {
  const { getText } = useText()
  const httpClient = useHttpClient()
  const toastAndLog = useToastAndLog()
  const { remoteBackend } = useBackends()
  const uploads = useUploadsToCloudStore()
  const queryClient = useQueryClient()

  return useEventCallback(
    /**
     * Upload a file from the Local backend to the Cloud backend.
     * @param localBackend - ignored, only used to double-check that the environment has a local backend
     */
    (localBackend: LocalBackend, options: UploadFileToCloudOptions) =>
      uploadAssetsToCloud(
        {
          queryClient,
          remoteBackend,
          httpClient,
          uploadFile: uploads.uploadFile.bind(uploads),
          resolveDuplications,
          getText,
          toastSuccess: (message) => toast.success(message),
          toastAndLogError: (textId, error) => toastAndLog(textId, error),
        },
        localBackend,
        options,
      ),
  )
}

/**
 * Download a file to local.
 * Does not work in environments that do not have a local backend.
 */
export function useUploadFileToLocal(category: Category) {
  const transferBetweenCategories = useTransferBetweenCategories()

  return useEventCallback(async (assets: readonly AnyAsset[]) => {
    await transferBetweenCategories(category, { type: 'local' }, assets)
  })
}
