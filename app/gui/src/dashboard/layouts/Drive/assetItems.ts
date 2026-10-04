/**
 * @file Every asset the drive's table has listed, by id: the Vue port of React's
 * `assetsTableItemsHooks`. The table records each directory's listing as it loads; the rows and the
 * context menus look an asset up (a pasted asset's parent, to check the user may move it there)
 * and list a directory's children (a renamed asset's siblings, which its new name must not clash
 * with), including directories listed before. React kept one such store for the window; this one
 * lives as long as the drive.
 */
import { createContextStore } from '@/providers'
import type { AnyAsset, AssetId, DirectoryId } from 'enso-common/src/services/Backend'
import { shallowRef } from 'vue'

/** See the file comment. */
export const [provideAssetItems, useAssetItems] = createContextStore('driveAssetItems', () => {
  const items = shallowRef<ReadonlyMap<AssetId, AnyAsset>>(new Map())

  return {
    items,
    /** Replace the children recorded for `parentId` with `assets`. */
    setItems(parentId: DirectoryId, assets: readonly AnyAsset[]) {
      items.value = new Map([
        ...[...items.value.entries()].filter(([, item]) => item.parentId !== parentId),
        ...assets.map((item) => [item.id, item] as const),
      ])
    },
    /** The asset with the given id, if the table has listed it. */
    getAsset(id: AssetId): AnyAsset | undefined {
      return items.value.get(id)
    },
    /** The listed children of a directory. */
    getAssetChildren(parentId: DirectoryId): AnyAsset[] {
      return [...items.value.values()].filter((asset) => asset.parentId === parentId)
    },
  }
})

/** The drive's listed assets; see {@link provideAssetItems}. */
export type AssetItems = ReturnType<typeof useAssetItems>
