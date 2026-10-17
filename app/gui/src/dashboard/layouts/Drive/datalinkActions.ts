/**
 * @file Creating a datalink and opening one: both show the datalink dialog on the modal stack. An
 * opened datalink is read first; one that cannot be read (missing, or not valid JSON) shows an
 * error toast and no dialog, so a save never overwrites what could not be shown.
 */
import UpsertDatalinkModal from '$/datalinks/UpsertDatalinkModal.vue'
import { useModals } from '$/providers/modals'
import { backendMutationOptions, backendQueryOptions } from '$/utils/backendQuery'
import { useQueryClient } from '@tanstack/vue-query'
import type { Backend, DatalinkAsset, DirectoryId } from 'enso-common/src/services/Backend'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useMutationCallback, useToastAndLog } from './driveActions'

/** A function opening the "Create Datalink" dialog for a folder; it returns the modal's key. */
export function useNewDatalink(backend: MaybeRefOrGetter<Backend>) {
  const modals = useModals()
  const createDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(backend), 'createDatalink'),
  )
  return (parentId: DirectoryId) =>
    modals.open(UpsertDatalinkModal, {
      doCreate: async (name: string, value: unknown) => {
        await createDatalink([{ name, value, parentDirectoryId: parentId, datalinkId: null }])
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
