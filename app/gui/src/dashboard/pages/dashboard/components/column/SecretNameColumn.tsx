/** @file The icon and name of a {@link SecretAsset}. */
import EditableSpan from '#/components/EditableSpan'
import { Icon } from '#/components/Icon'
import { backendMutationOptions, useRenameAsset } from '#/hooks/backendHooks'
import { useToastAndLog } from '#/hooks/toastAndLogHooks'
import { useGetAssetChildren } from '#/layouts/Drive/assetsTableItemsHooks'
import UpsertSecretModal from '#/modals/UpsertSecretModal'
import type { AssetNameColumnProps } from '#/pages/dashboard/components/column'
import { useDriveState, useDriveStore } from '#/providers/DriveProvider'
import { setModal } from '#/providers/ModalProvider'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import { toast } from '#/utilities/toast'
import { useText } from '$/providers/react'
import { useDriveCurrentBackend } from '$/providers/react/container'
import { isDoubleClick } from '$/utils/event'
import { isAssetCredential, titleSchema, type SecretAsset } from 'enso-common/src/services/Backend'

/** Props for a {@link SecretNameColumn}. */
export interface SecretNameColumnProps extends AssetNameColumnProps {
  readonly item: SecretAsset
}

/** The icon and name of a {@link SecretAsset}. */
export default function SecretNameColumn(props: SecretNameColumnProps) {
  const { item, isEditable } = props

  const backend = useDriveCurrentBackend()
  const toastAndLog = useToastAndLog()
  const { getText } = useText()
  const getAssetChildren = useGetAssetChildren()
  const renameAsset = useRenameAsset(backend)
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

  const updateSecret = useMutationCallback(backendMutationOptions(backend, 'updateSecret'))

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
        if (isDoubleClick(event) && isEditable) {
          if (isAssetCredential(item)) {
            toast.warning(getText('cannotEditCredentialError'))
          } else {
            event.stopPropagation()
            setModal(
              <UpsertSecretModal
                secretId={item.id}
                name={item.title}
                doCreate={async (title, value) => {
                  try {
                    await updateSecret([item.id, { title, value }, item.title])
                  } catch (error) {
                    toastAndLog(null, error)
                  }
                }}
              />,
            )
          }
        }
      }}
    >
      <Icon icon="key" className="m-name-column-icon size-4" />
      <EditableSpan
        data-testid="asset-row-name"
        editable={isEditingName}
        className="grow bg-transparent"
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
      >
        {item.title}
      </EditableSpan>
    </div>
  )
}
