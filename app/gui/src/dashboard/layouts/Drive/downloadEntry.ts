/** @file Whether the context menu offers "Download" for a single asset. */
import { AssetType } from 'enso-common/src/services/Backend'

/**
 * A project and a datalink can be downloaded: a datalink downloads as the file itself, keeping its
 * `.datalink` extension.
 */
export function canDownloadAsset(type: AssetType): boolean {
  return type === AssetType.project || type === AssetType.datalink
}
