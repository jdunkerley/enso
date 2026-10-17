/** @file Whether the context menu offers "Download" for a single asset. */
import { AssetType } from 'enso-common/src/services/Backend'

/**
 * In the cloud every asset but a directory can be downloaded. Locally a project and a datalink
 * can: a datalink downloads as the file itself, keeping its `.datalink` extension.
 */
export function canDownloadAsset(isCloud: boolean, type: AssetType): boolean {
  return isCloud ?
      type !== AssetType.directory
    : type === AssetType.project || type === AssetType.datalink
}
