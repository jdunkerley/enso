/**
 * @file The context-menu entries available everywhere in a directory (upload, new project, folder,
 * secret, credential and datalink, and paste): the Vue port of React's
 * `useGlobalContextMenuEntries`. The credential and datalink dialogs are still React's (#198).
 */
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import UpsertSecretModal from '$/cloud/credentials/UpsertSecretModal.vue'
import type { CategoryType } from '$/providers/category'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { backendMutationOptions } from '$/utils/backendQuery'
import { BackendType, type Backend, type DirectoryId } from 'enso-common/src/services/Backend'
import { readUserSelectedFile } from 'enso-common/src/utilities/file'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useMutationCallback, useNewFolder, useNewProject, useUploadFiles } from './driveActions'
import { openCreateCredentialModal, openUpsertDatalinkModal } from './reactModals'

/** Options of {@link useGlobalContextMenuEntries}. */
export interface GlobalContextMenuEntriesOptions {
  readonly backend: MaybeRefOrGetter<Backend>
  readonly category: MaybeRefOrGetter<CategoryType>
  readonly currentDirectoryId: MaybeRefOrGetter<DirectoryId>
  /** The directory the entries act on, when it is not the current one (a directory's own menu). */
  readonly directoryId: MaybeRefOrGetter<DirectoryId | null>
  readonly doPaste: (newParentId: DirectoryId) => void
}

/** See the file comment. */
export function useGlobalContextMenuEntries(options: GlobalContextMenuEntriesOptions) {
  const driveStore = useDriveStore()
  const modals = useModals()

  const target = () => toValue(options.directoryId) ?? toValue(options.currentDirectoryId)
  const newFolder = useNewFolder(options.backend, options.category, driveStore)
  const newProject = useNewProject(options.backend, options.category)
  const uploadFiles = useUploadFiles(options.backend, options.category, driveStore)
  const newSecret = useMutationCallback(() =>
    backendMutationOptions(toValue(options.backend), 'createSecret'),
  )
  const newCredential = useMutationCallback(() =>
    backendMutationOptions(toValue(options.backend), 'createCredential'),
  )
  const newDatalink = useMutationCallback(() =>
    backendMutationOptions(toValue(options.backend), 'createDatalink'),
  )

  const hasPasteData = computed(() => (driveStore.pasteData?.data.assets.length ?? 0) > 0)

  return computed((): (ContextMenuEntry | false)[] => {
    const isCloud = toValue(options.backend).type === BackendType.remote
    return [
      {
        action: 'uploadFiles',
        doAction: () => {
          void readUserSelectedFile({ multiple: true }).then((files) =>
            uploadFiles(Array.from(files), target()),
          )
        },
      },
      {
        action: 'newProject',
        doAction: () => {
          void newProject({}, target())
        },
      },
      {
        action: 'newFolder',
        doAction: () => {
          void newFolder(target())
        },
      },
      isCloud && {
        action: 'newSecret',
        doAction: () => {
          modals.closeAll()
          modals.open(UpsertSecretModal, {
            onCreate: async (name: string, value: string) => {
              await newSecret([{ name, value, parentDirectoryId: target() }])
            },
          })
        },
      },
      isCloud && {
        action: 'newCredential',
        doAction: () => {
          openCreateCredentialModal('replace', (name, value) =>
            newCredential([{ name, value, parentDirectoryId: target() }]),
          )
        },
      },
      isCloud && {
        action: 'newDatalink',
        doAction: () => {
          openUpsertDatalinkModal('replace', async (name, value) => {
            await newDatalink([{ name, value, parentDirectoryId: target(), datalinkId: null }])
          })
        },
      },
      hasPasteData.value &&
        toValue(options.directoryId) == null && {
          action: 'paste',
          doAction: () => {
            options.doPaste(toValue(options.currentDirectoryId))
          },
        },
    ]
  })
}
