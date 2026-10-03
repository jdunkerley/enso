/** @file The icon and name of a {@link SecretAsset}. */
import EditableSpan from '#/components/EditableSpan'
import { Icon } from '#/components/Icon'
import { useRenameAsset } from '#/hooks/backendHooks'
import { useGetAssetChildren } from '#/layouts/Drive/assetsTableItemsHooks'
import type { AssetNameColumnProps } from '#/pages/dashboard/components/column'
import { useDriveState, useDriveStore } from '#/providers/DriveProvider'
import { useDriveCurrentBackend, useRightPanelData } from '$/providers/react/container'
import { isDoubleClick } from '$/utils/event'
import { titleSchema, type DatalinkAsset } from 'enso-common/src/services/Backend'

/** Props for a {@link DatalinkNameColumn}. */
export interface DatalinkNameColumnProps extends AssetNameColumnProps {
  readonly item: DatalinkAsset
}

/**
 * The icon and name of a {@link DatalinkAsset}.
 * @throws {Error} when the asset is not a {@link DatalinkAsset}.
 * This should never happen.
 */
export default function DatalinkNameColumn(props: DatalinkNameColumnProps) {
  const { item, isEditable } = props

  const backend = useDriveCurrentBackend()
  const getAssetChildren = useGetAssetChildren()
  const renameAsset = useRenameAsset(backend)
  const rightPanel = useRightPanelData()
  const driveStore = useDriveStore()

  const isEditingName = useDriveState(({ assetToRename }) => assetToRename === item.id)
  const setIsEditing = (isEditing: boolean) => {
    if (isEditing) {
      if (isEditable) {
        driveStore.update({ assetToRename: item.id })
      }
    } else {
      driveStore.update({ assetToRename: null })
    }
  }

  const doRename = async (newTitle: string) => {
    await renameAsset(item.id, newTitle)
    setIsEditing(false)
  }

  return (
    <div
      className="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
      onKeyDown={(event) => {
        if (isEditingName && event.key === 'Enter') {
          event.stopPropagation()
        }
      }}
      onClick={(event) => {
        if (isDoubleClick(event)) {
          event.stopPropagation()
          rightPanel.setTemporaryTab('settings')
        }
      }}
    >
      <Icon icon="connector" className="m-name-column-icon" />
      <EditableSpan
        editable={isEditingName}
        onSubmit={doRename}
        onCancel={() => {
          setIsEditing(false)
        }}
        schema={() =>
          titleSchema({
            id: item.id,
            siblings: getAssetChildren(item.parentId),
          })
        }
        className="grow bg-transparent"
      >
        {item.title}
      </EditableSpan>
    </div>
  )
}
