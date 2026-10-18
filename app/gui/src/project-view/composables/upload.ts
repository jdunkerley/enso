import type { ToValue } from '$/utils/reactivity'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import type { Backend, UploadFileRequestParams } from 'enso-common/src/services/Backend'

/** Function for uploading files to the local backend. */
function useUploadLocally(backend: ToValue<Backend | null>) {
  const uploadFileStart = useMutation(backendMutationOptions('uploadFileStart', backend))
  const uploadFileEnd = useMutation(backendMutationOptions('uploadFileEnd', backend))

  return async (file: File, params: UploadFileRequestParams) => {
    const data = await uploadFileStart.mutateAsync([params, file])
    if (!data) {
      return
    }
    const { uploadId, sourcePath } = data
    return await uploadFileEnd.mutateAsync([
      {
        uploadId,
        sourcePath,
        parts: [],
        assetId: params.fileId,
        ...params,
      },
    ])
  }
}

/** A function to upload a file to the backend. */
export function useUpload(backend: ToValue<Backend | null>) {
  return useUploadLocally(backend)
}
