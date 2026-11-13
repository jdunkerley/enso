/**
 * @file Whether assets may be moved or copied into a directory. A directory cannot go into itself
 * or into any directory below it; the local backend's directory ids carry the directory's path, so
 * the nesting is read from the ids.
 */
import {
  AssetType,
  extractTypeAndPath,
  type AssetId,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { normalizePath } from 'enso-common/src/utilities/file'

/** The path an id carries, with `/` separators and no trailing one; `null` for an unknown id. */
function idPath(id: AssetId) {
  try {
    return normalizePath(extractTypeAndPath(id).path).replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Whether the directory `inner` is the directory `outer` or a directory below it. */
export function isDirectoryWithin(inner: DirectoryId, outer: DirectoryId) {
  if (inner === outer) return true
  const outerPath = idPath(outer)
  const innerPath = idPath(inner)
  if (outerPath == null || innerPath == null || outerPath === '') return false
  return innerPath === outerPath || innerPath.startsWith(outerPath + '/')
}

/** An asset about to be moved or copied. */
interface DroppedAsset {
  readonly id: AssetId
  readonly type: AssetType
}

/**
 * Whether all of `assets` may go into the directory `targetId`: none of them is a directory that
 * is `targetId` itself or contains it.
 */
export function canDropAssetsInto(assets: Iterable<DroppedAsset>, targetId: DirectoryId) {
  for (const asset of assets) {
    if (asset.type === AssetType.directory && isDirectoryWithin(targetId, asset.id as DirectoryId))
      return false
  }
  return true
}
