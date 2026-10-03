/**
 * @file Uploading files: the store of the uploads to the cloud in progress
 * ({@link useUploadsToCloudStore}), and {@link uploadFiles}, which uploads files the user picked
 * or dropped into a drive directory, on either backend. `uploadFiles` is framework-free: it moved
 * here from the React `#/hooks/backendUploadFilesHooks` (#192), whose hook now only gives it the
 * React drive's stores.
 */
import type { ResolvedDuplication } from '$/components/Drive/duplicateAssets'
import type { CategoryType } from '$/providers/category'
import type { SelectedAssetInfo } from '$/providers/driveStore'
import {
  backendMutationOptions as backendMutationOptionsFor,
  executeMutation,
} from '$/utils/backendQuery'
import { ConditionVariable } from '$/utils/ConditionVariable'
import type { DuplicationResolver } from '$/utils/driveMutations'
import { ensureListDirectory } from '$/utils/driveQueries'
import { backendMutationOptions } from '@/composables/backend'
import type { QueryClient } from '@tanstack/query-core'
import * as vueQuery from '@tanstack/vue-query'
import { createGlobalState } from '@vueuse/core'
import {
  AssetType,
  BackendType,
  escapeSpecialCharacters,
  extractProjectExtension,
  fileIsProject,
  stripProjectExtension,
  type AssetId,
  type Backend,
  type DirectoryId,
  type FileId,
  type HttpsUrl,
  type ProjectId,
  type UploadedAsset,
  type UploadFileRequestParams,
} from 'enso-common/src/services/Backend'
import { reactive } from 'vue'
import { useBackends } from './backends'
import { useFeatureFlag } from './featureFlags'

/** The delay, in milliseconds, before query data for a file being uploaded is cleared. */
const CLEAR_PROGRESS_DELAY_MS = 5_000
const RETRIES = 3

export type UploadKind = 'requestedByUser' | 'hybridSync'

export interface OngoingUpload {
  kind?: UploadKind | undefined
  sentBytes: number
  totalBytes: number
  finished: boolean
  abortController: AbortController
}

export type UploadsToCloudStore = ReturnType<typeof createUploadsStore>

/** Constructor of UploadsToCloudStore. see {@link useUploadsToCloudStore}  docs. */
export function createUploadsStore(backend: Backend) {
  const uploads = reactive(new Map<string, OngoingUpload>())
  const chunkUploadPoolSize = useFeatureFlag('fileChunkUploadPoolSize')
  let chunksBeingUploaded = 0
  const chunkUploadCondVar = new ConditionVariable()

  const uploadFileStart = vueQuery.useMutation(backendMutationOptions('uploadFileStart', backend))
  const uploadFileChunk = vueQuery.useMutation(
    backendMutationOptions('uploadFileChunk', backend, { retry: RETRIES }),
  )
  const uploadFileEnd = vueQuery.useMutation(
    backendMutationOptions('uploadFileEnd', backend, { retry: RETRIES }),
  )

  async function uploadChunk(url: HttpsUrl, file: File, index: number, abort: AbortSignal) {
    while (chunkUploadPoolSize.value > 0 && chunksBeingUploaded >= chunkUploadPoolSize.value) {
      await chunkUploadCondVar.wait()
      abort.throwIfAborted()
    }
    chunksBeingUploaded += 1
    return uploadFileChunk.mutateAsync([url, file, index, abort]).finally(() => {
      chunksBeingUploaded -= 1
      chunkUploadCondVar.notifyOne()
    })
  }

  async function uploadFile(file: File, params: UploadFileRequestParams, kind?: UploadKind) {
    const abortController = new AbortController()
    const { sourcePath, uploadId, presignedUrls } = await uploadFileStart.mutateAsync([
      params,
      file,
      abortController.signal,
    ])

    const data: OngoingUpload = reactive({
      kind,
      sentBytes: 0,
      totalBytes: file.size,
      finished: false,
      abortController,
    })
    uploads.set(uploadId, data)

    const parts = await Promise.all(
      presignedUrls.map((url, i) =>
        uploadChunk(url, file, i, abortController.signal).then(({ part, size }) => {
          data.sentBytes += size
          return part
        }),
      ),
    )
    const result = await uploadFileEnd.mutateAsync([
      {
        parentDirectoryId: params.parentDirectoryId,
        parts,
        sourcePath: sourcePath,
        uploadId: uploadId,
        assetId: params.fileId,
        fileName: params.fileName,
      },
      abortController.signal,
    ])
    data.finished = true
    setTimeout(() => {
      uploads.delete(uploadId)
    }, CLEAR_PROGRESS_DELAY_MS)
    return result
  }

  return { uploads, uploadFile }
}

/**
 * Uploads to Cloud Store.
 *
 * This store handles and keeps track of multipart file upload to Remote Backend.
 * The number of chunks uploaded at once is throttled by 'fileChunkUploadPoolSize'
 * feature flag. `uploads` map contains all uploads with their progress, including
 * the uploads finished no longer than {@link CLEAR_PROGRESS_DELAY_MS} ago.
 */
export const useUploadsToCloudStore = createGlobalState(() => {
  const { remoteBackend } = useBackends()
  return createUploadsStore(remoteBackend)
})

/** What {@link uploadFiles} needs from the app. */
export interface UploadFilesContext {
  readonly queryClient: QueryClient
  readonly backend: Backend
  /** The category of the target directory, whose listing gives the names already taken. */
  readonly category: CategoryType
  /** The uploads store's `uploadFile`, used for the cloud. */
  readonly uploadToCloud: (
    file: File,
    params: UploadFileRequestParams,
    kind?: UploadKind,
  ) => Promise<UploadedAsset>
  readonly resolveDuplications: DuplicationResolver
  /** Called with all the assets uploaded so far, after each upload: the drive selects them. */
  readonly onUploaded: (uploaded: readonly SelectedAssetInfo[]) => void
}

/** Upload a file to the local backend, which needs no multipart upload. */
async function uploadLocally(
  queryClient: QueryClient,
  backend: Backend,
  file: File,
  params: UploadFileRequestParams,
) {
  const { uploadId, sourcePath } = await executeMutation(
    queryClient,
    backendMutationOptionsFor(backend, 'uploadFileStart'),
    [params, file],
  )
  return executeMutation(queryClient, backendMutationOptionsFor(backend, 'uploadFileEnd'), [
    { uploadId, sourcePath, parts: [], assetId: params.fileId, ...params },
  ])
}

/**
 * Upload files into a directory. A file whose name is taken there is uploaded once the user has
 * chosen to rename it or to replace the existing asset, or skipped.
 */
export async function uploadFiles(
  context: UploadFilesContext,
  filesToUpload: readonly File[],
  parentId: DirectoryId,
) {
  const { queryClient, backend, category } = context
  const uploadFile = (file: File, params: UploadFileRequestParams) =>
    backend.type === BackendType.local ?
      uploadLocally(queryClient, backend, file, params)
    : context.uploadToCloud(file, params, 'requestedByUser')

  const reversedFiles = Array.from(filesToUpload).reverse()
  const siblings = await ensureListDirectory(queryClient, backend, category, parentId)
  const siblingsByTitle = new Map(siblings.map((asset) => [asset.title, asset]))
  const files = reversedFiles.map((file) => ({
    title: escapeSpecialCharacters(
      fileIsProject(file) ? stripProjectExtension(file.name) : file.name,
    ),
    file,
  }))
  const duplicates = new Map(
    files.flatMap((file) => {
      const asset = siblingsByTitle.get(file.title)
      return asset ? [[file.file, { asset, ...file }]] : []
    }),
  )
  const uploadedFileInfos: SelectedAssetInfo[] = []
  const addToSelection = (info: SelectedAssetInfo) => {
    uploadedFileInfos.push(info)
    context.onUploaded(uploadedFileInfos)
  }

  const doUploadFile = async (file: File, title: string, fileId: AssetId | null = null) => {
    if (fileIsProject(file)) {
      const { extension } = extractProjectExtension(file.name)
      title = escapeSpecialCharacters(stripProjectExtension(title))
      const result = await uploadFile(file, {
        fileId,
        fileName: `${title}.${extension}`,
        parentDirectoryId: parentId,
      })
      if (result.jobId != null) return
      addToSelection({
        type: AssetType.project,
        // This is SAFE, because it is guarded behind `fileIsProject`.
        id: result.id as ProjectId,
        parentId,
        title,
      })
    } else {
      title = escapeSpecialCharacters(title)
      const result = await uploadFile(file, {
        fileId,
        fileName: title,
        parentDirectoryId: parentId,
      })
      if (result.jobId != null) return
      addToSelection({
        type: AssetType.file,
        // This is SAFE, because it is not a project.
        id: result.id as FileId,
        parentId,
        title,
      })
    }
  }

  const resolutions: readonly ResolvedDuplication[] =
    duplicates.size === 0 ?
      []
    : await context.resolveDuplications({
        targetId: parentId,
        conflictingIds: Array.from(duplicates.values(), ({ asset }) => asset.id),
      })
  const resolutionsById = new Map(resolutions.map((resolution) => [resolution.assetId, resolution]))

  await Promise.allSettled(
    files.flatMap(({ file, title }) => {
      const duplicate = duplicates.get(file)
      if (duplicate == null) {
        return [doUploadFile(file, title)]
      }
      const resolution = resolutionsById.get(duplicate.asset.id)
      if (resolution == null) {
        return [doUploadFile(file, title)]
      }
      switch (resolution.conclusion) {
        case 'rename': {
          return [doUploadFile(duplicate.file, resolution.newName)]
        }
        case 'replace': {
          return [doUploadFile(duplicate.file, duplicate.asset.title, duplicate.asset.id)]
        }
        case 'skip': {
          return []
        }
      }
    }),
  )
}
