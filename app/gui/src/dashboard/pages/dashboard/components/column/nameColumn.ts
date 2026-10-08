/**
 * @file What every name cell of the drive's table shares: whether its asset is being renamed, and
 * renaming it, through the drive store's `assetToRename`.
 */
import { useAssetItems } from '#/layouts/Drive/assetItems'
import { useRenameAsset } from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import { useDriveStore } from '$/providers/driveStore'
import { titleSchema, type AnyAsset } from 'enso-common/src/services/Backend'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

/** The rename state and actions of a name cell. */
export function useNameCell(
  item: MaybeRefOrGetter<AnyAsset>,
  isEditable: MaybeRefOrGetter<boolean>,
) {
  const driveStore = useDriveStore()
  const driveView = useDriveView()
  const assetItems = useAssetItems()
  const renameAsset = useRenameAsset(() => driveView.location.backend)

  const isEditingName = computed(() => driveStore.assetToRename === toValue(item).id)

  /** Start renaming the asset (when it may be edited), or stop. */
  const setIsEditing = (isEditing: boolean) => {
    if (isEditing) {
      if (toValue(isEditable)) driveStore.update({ assetToRename: toValue(item).id })
    } else {
      driveStore.update({ assetToRename: null })
    }
  }

  /** Rename the asset, and stop renaming it. */
  const doRename = async (newTitle: string) => {
    await renameAsset(toValue(item).id, newTitle)
    setIsEditing(false)
  }

  /** The check of a new name: it must be valid, and unique among the asset's siblings. */
  const schema = () => {
    const asset = toValue(item)
    return titleSchema({ id: asset.id, siblings: assetItems.getAssetChildren(asset.parentId) })
  }

  return { isEditingName, setIsEditing, doRename, schema }
}

/**
 * What opening a directory from its row is (its button, a double click, or a drag held over it),
 * for the drive to show the spinner on the row's button until the directory is shown.
 */
export function directoryNavigationSource(id: AnyAsset['id']) {
  return `directory:${id}`
}
