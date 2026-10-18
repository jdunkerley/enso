/**
 * @file Creating a datalink and opening one: both show the datalink dialog on the modal stack. An
 * opened datalink is read first; one that cannot be read (missing, or not valid JSON) shows an
 * error toast and no dialog, so a save never overwrites what could not be shown.
 */
import UpsertDatalinkModal from '$/datalinks/UpsertDatalinkModal.vue'
import type { CategoryType } from '$/providers/category'
import type { DriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions, backendQueryOptions } from '$/utils/backendQuery'
import { ensureListDirectory } from '$/utils/driveQueries'
import { useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  titleWithoutExtension,
  type Backend,
  type DatalinkAsset,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { DATALINK_EXTENSION } from 'enso-common/src/services/LocalBackend'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useMutationCallback, useToastAndLog } from './driveActions'

/**
 * A function opening the "Create Datalink" dialog for a folder; it returns the modal's key. A
 * created datalink is selected. A name that, without a typed `.datalink`, is a sibling's title is
 * refused.
 */
export function useNewDatalink(
  backend: MaybeRefOrGetter<Backend>,
  category: MaybeRefOrGetter<CategoryType>,
  driveStore: DriveStore,
) {
  const modals = useModals()
  const queryClient = useQueryClient()
  const { getText } = useText()
  const createDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(backend), 'createDatalink'),
  )
  return (parentId: DirectoryId) =>
    modals.open(UpsertDatalinkModal, {
      doCreate: async (name: string, value: unknown) => {
        const title = titleWithoutExtension(name, DATALINK_EXTENSION)
        const siblings = await ensureListDirectory(
          queryClient,
          toValue(backend),
          toValue(category),
          parentId,
        )
        if (
          siblings.some((sibling) => sibling.title.trim().toLowerCase() === title.toLowerCase())
        ) {
          throw new Error(getText('nameShouldBeUnique'))
        }
        const result = await createDatalink([
          { name: title, value, parentDirectoryId: parentId, datalinkId: null },
        ])
        driveStore.setSelectedAssets([{ type: AssetType.datalink, id: result.id, title, parentId }])
      },
    })
}

/** A function opening a datalink in the dialog; saving writes the same datalink. */
export function useEditDatalink(backend: MaybeRefOrGetter<Backend>) {
  const modals = useModals()
  const queryClient = useQueryClient()
  const toastAndLog = useToastAndLog()
  const saveDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(backend), 'createDatalink'),
  )
  return async (asset: DatalinkAsset) => {
    let value: unknown
    try {
      value = await queryClient.fetchQuery({
        ...backendQueryOptions(toValue(backend), 'getDatalink', [asset.id, asset.title]),
        staleTime: 0,
      })
    } catch (error) {
      toastAndLog('getDatalinkBackendError', error, asset.title)
      return
    }
    modals.closeAll()
    modals.open(UpsertDatalinkModal, {
      existing: { name: asset.title, value },
      doCreate: async (_name: string, newValue: unknown) => {
        await saveDatalink([
          {
            name: asset.title,
            value: newValue,
            parentDirectoryId: asset.parentId,
            datalinkId: asset.id,
          },
        ])
      },
    })
  }
}
