/** @file Schemas for the assets carried by a drag-and-drop or clipboard data transfer. */
import { AssetType, type AssetId, type DirectoryId } from 'enso-common/src/services/Backend'
import { z } from 'zod'

/** A transferrable asset. */
export const TRANSFERRABLE_ASSET_SCHEMA = z.object({
  id: z.string().transform((id) => id as AssetId),
  title: z.string(),
  type: z.nativeEnum(AssetType),
  parentId: z.string().transform((id) => id as DirectoryId),
  parentsPath: z.string(),
  virtualParentsPath: z.string(),
})

/** A data transfer payload for assets. */
export const ASSETS_DATA_TRANSFER_PAYLOAD = z.object({
  category: z.string(),
  items: z.array(TRANSFERRABLE_ASSET_SCHEMA),
})

/** A data transfer payload for assets. */
export type AssetsDataTransferPayload = z.infer<typeof ASSETS_DATA_TRANSFER_PAYLOAD>

/** A transferrable asset. */
export type TransferrableAsset = z.infer<typeof TRANSFERRABLE_ASSET_SCHEMA>
