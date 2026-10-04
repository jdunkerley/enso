/**
 * @file Uploading assets from the local drive to the Enso Cloud: packing each local project into a
 * file and uploading it through the uploads store, after asking how to resolve name conflicts.
 * Framework-free, moved out of the React `#/hooks/backendUploadFilesHooks` (#192): moving assets
 * from a local category to a cloud one calls it, from React and Vue alike. It is cloud-only, but a
 * helper rather than an area, so the core may import it (`src/cloud/CLAUDE.md`).
 */
import type { GetText } from '$/providers/text'
import type { UploadKind } from '$/providers/upload'
import type { DuplicationResolver } from '$/utils/driveMutations'
import { listDirectoryQueryOptions } from '$/utils/driveQueries'
import type { QueryClient } from '@tanstack/query-core'
import {
  AssetType,
  type AnyAsset,
  type AssetId,
  type Backend,
  type DirectoryId,
  type UploadFileRequestParams,
  type UploadedAsset,
} from 'enso-common/src/services/Backend'
import type { HttpClient } from 'enso-common/src/services/HttpClient'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'

/** An asset that can be uploaded to the cloud. */
export type UploadToCloudAsset<Type extends AssetType> = Pick<
  AnyAsset,
  'id' | 'parentId' | 'title'
> & {
  readonly type: Type
  readonly newName?: string
  /** The id of an existing cloud asset to replace. */
  readonly cloudId?: AssetId
  /** A list of siblings, if it has been fetched already. */
  readonly siblings?: readonly AnyAsset<AssetType>[]
}

/**
 * Type that represents an asset that can be uploaded to the cloud.
 * From the local backend's perspective, this is any asset that is not a folder.
 * Theoretically, we _could_ upload folders to the cloud, but at this point it is a bit complex to do
 */
export type UploadableAsset =
  UploadToCloudAsset<AssetType.file> | UploadToCloudAsset<AssetType.project>

const UPLOADABLE_ASSETS_SET = new Set([AssetType.file, AssetType.project])

/** Whether the asset is uploadable. */
export function isUploadableAsset(asset: UploadToCloudAsset<AssetType>): asset is UploadableAsset {
  return UPLOADABLE_ASSETS_SET.has(asset.type)
}

/** What to upload to the cloud, and where. */
export interface UploadFileToCloudOptions {
  /** The assets to upload. */
  readonly assets: readonly UploadToCloudAsset<AnyAsset['type']>[]
  /** The directory to upload the assets to. */
  readonly targetDirectoryId: DirectoryId
}

/** What {@link uploadAssetsToCloud} needs from the app. */
export interface UploadToCloudContext {
  readonly queryClient: QueryClient
  readonly remoteBackend: Backend
  readonly httpClient: HttpClient
  /** The uploads store's `uploadFile` (`$/providers/upload`). */
  readonly uploadFile: (
    file: File,
    params: UploadFileRequestParams,
    kind?: UploadKind,
  ) => Promise<UploadedAsset>
  readonly resolveDuplications: DuplicationResolver
  readonly getText: GetText
  readonly toastSuccess: (message: string) => void
  /** Show an error toast whose message starts with the text, and log it. */
  readonly toastAndLogError: (textId: 'uploadProjectToCloudError', error: unknown) => void
}

/** Both the deleted and the non-deleted children of a cloud directory. */
async function getSiblings(context: UploadToCloudContext, parentId: DirectoryId) {
  const { queryClient, remoteBackend: backend } = context
  const list = (type: 'cloud' | 'trash') =>
    queryClient.fetchQuery(
      listDirectoryQueryOptions({
        backend,
        parentId,
        category: { type },
        labels: null,
        sortExpression: null,
        sortDirection: null,
        refetchInterval: null,
      }),
    )
  const [nonDeletedAssets, deletedAssets] = await Promise.all([list('cloud'), list('trash')])
  return [...nonDeletedAssets.assets, ...deletedAssets.assets] as const
}

/** The file to upload for an asset: a project packed into an `.enso-project` file. */
async function fileToUpload(context: UploadToCloudContext, asset: UploadableAsset) {
  const newName = asset.newName ?? asset.title
  switch (asset.type) {
    case AssetType.project: {
      const projectResponse = await context.httpClient.get(`/api/projects/${asset.id}/download`)
      if (!projectResponse.ok) {
        throw new Error('Something went wrong, please try again')
      }
      const fileName = `${newName}.enso-project`
      return { fileName, file: new File([await projectResponse.blob()], fileName) }
    }
    case AssetType.file: {
      // TODO: @MrFlashAccount  Implement file upload
      throw new Error('File upload is not supported yet')
    }
    default:
      throw new Error('Unknown asset type')
  }
}

/**
 * Pack local projects into files and upload them to a cloud directory. A project whose name is
 * taken there is uploaded once the user has chosen to rename it or to replace the cloud asset;
 * every upload toasts its success or failure.
 * @param localBackend - Only checks that the environment has a local backend.
 */
export async function uploadAssetsToCloud(
  context: UploadToCloudContext,
  localBackend: LocalBackend,
  options: UploadFileToCloudOptions,
): Promise<void> {
  const { assets, targetDirectoryId } = options
  const siblings = await getSiblings(context, targetDirectoryId)
  const assetsMap = new Map(assets.map((asset) => [asset.id, asset]))
  const siblingsMap = new Map(siblings.map((sibling) => [sibling.title, sibling]))

  const uploadableAssets: UploadableAsset[] = []
  const conflictingAssets: UploadableAsset[] = []
  for (const asset of assets) {
    if (!isUploadableAsset(asset)) continue
    const sibling = asset.cloudId == null ? siblingsMap.get(asset.newName ?? asset.title) : null
    if (sibling) {
      conflictingAssets.push({ ...asset, cloudId: sibling.id })
    } else {
      uploadableAssets.push(asset)
    }
  }

  const uploadConflicting = async () => {
    if (conflictingAssets.length === 0) {
      return
    }

    const resolutions = await context.resolveDuplications({
      canReplace: true,
      targetId: targetDirectoryId,
      conflictingIds: conflictingAssets.map((asset) => asset.id),
      category: { type: 'cloud' },
      backend: context.remoteBackend,
    })

    const renames = resolutions.flatMap((resolution): UploadToCloudAsset<AssetType>[] => {
      const asset = assetsMap.get(resolution.assetId)
      return resolution.conclusion === 'rename' && asset ?
          [{ ...asset, newName: resolution.newName }]
        : []
    })
    const replaces = resolutions.flatMap((resolution): UploadToCloudAsset<AssetType>[] => {
      const asset = assetsMap.get(resolution.assetId)
      const sibling = asset && siblingsMap.get(asset.title)
      return resolution.conclusion === 'replace' && asset && sibling ?
          [{ ...asset, cloudId: sibling.id }]
        : []
    })

    await uploadAssetsToCloud(context, localBackend, {
      assets: [...renames, ...replaces],
      targetDirectoryId,
    })
  }

  await Promise.all([
    uploadConflicting(),
    ...uploadableAssets.map(async (asset) => {
      try {
        const { file, fileName } = await fileToUpload(context, asset)
        await context.uploadFile(
          file,
          { fileName, fileId: asset.cloudId ?? null, parentDirectoryId: targetDirectoryId },
          'requestedByUser',
        )
        context.toastSuccess(context.getText('uploadProjectToCloudSuccess'))
      } catch (error) {
        context.toastAndLogError('uploadProjectToCloudError', error)
      }
    }),
  ])
}
