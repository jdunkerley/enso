/** @file Context menu entries available everywhere in the directory. */
import { backendMutationOptions, useNewFolder, useNewProject } from '#/hooks/backendHooks'
import { useUploadFiles } from '#/hooks/backendUploadFilesHooks'
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { defineMenuEntries } from '#/hooks/menuHooks'
import { useDriveState } from '#/providers/DriveProvider'
import { setVueModal } from '#/providers/ModalProvider'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import CreateCredentialModal from '$/cloud/credentials/CreateCredentialModal.vue'
import UpsertSecretModal from '$/cloud/credentials/UpsertSecretModal.vue'
import UpsertDatalinkModal from '$/cloud/datalinks/UpsertDatalinkModal.vue'
import type { CategoryType } from '$/providers/category'
import type { Backend } from 'enso-common/src/services/Backend'
import {
  BackendType,
  type CredentialConfig,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { readUserSelectedFile } from 'enso-common/src/utilities/file'

/** Props for a {@link GlobalContextMenuEntries}. */
export interface GlobalContextMenuEntriesOptions {
  readonly backend: Backend
  readonly category: CategoryType
  readonly currentDirectoryId: DirectoryId
  readonly directoryId: DirectoryId | null
  readonly doPaste: (newParentId: DirectoryId) => void
}

/** Context menu entries available everywhere in the directory. */
export function useGlobalContextMenuEntries(options: GlobalContextMenuEntriesOptions) {
  const { backend, category, directoryId = null, currentDirectoryId, doPaste } = options

  const isCloud = backend.type === BackendType.remote

  const hasPasteData = useDriveState(
    (storeState) => (storeState.pasteData?.data.assets.length ?? 0) > 0,
  )

  const newFolderRaw = useNewFolder(backend, category)
  const newFolder = useEventCallback(async () => {
    return await newFolderRaw(directoryId ?? currentDirectoryId)
  })
  const newSecret = useMutationCallback(backendMutationOptions(backend, 'createSecret'))
  const newCredential = useMutationCallback(backendMutationOptions(backend, 'createCredential'))
  const newDatalink = useMutationCallback(backendMutationOptions(backend, 'createDatalink'))
  const newProjectRaw = useNewProject(backend, category)
  const newProject = useEventCallback(() => newProjectRaw({}, directoryId ?? currentDirectoryId))
  const uploadFilesRaw = useUploadFiles(backend, category)
  const uploadFiles = useEventCallback((files: readonly File[]) =>
    uploadFilesRaw(files, directoryId ?? currentDirectoryId),
  )

  return defineMenuEntries([
    {
      action: 'uploadFiles',
      doAction: () => {
        void readUserSelectedFile({ multiple: true }).then((files) =>
          uploadFiles(Array.from(files)),
        )
      },
    },
    {
      action: 'newProject',
      doAction: () => {
        void newProject()
      },
    },
    {
      action: 'newFolder',
      doAction: () => {
        void newFolder()
      },
    },
    isCloud && {
      action: 'newSecret',
      doAction: () => {
        setVueModal(UpsertSecretModal, {
          onCreate: async (name: string, value: string) => {
            await newSecret([{ name, value, parentDirectoryId: directoryId ?? currentDirectoryId }])
          },
        })
      },
    },
    isCloud && {
      action: 'newCredential',
      doAction: () => {
        setVueModal(CreateCredentialModal, {
          doCreate: async (name: string, value: CredentialConfig) =>
            await newCredential([
              { name, value, parentDirectoryId: directoryId ?? currentDirectoryId },
            ]),
        })
      },
    },
    isCloud && {
      action: 'newDatalink',
      doAction: () => {
        setVueModal(UpsertDatalinkModal, {
          doCreate: async (name: string, value: unknown) => {
            await newDatalink([
              {
                name,
                value,
                parentDirectoryId: directoryId ?? currentDirectoryId,
                datalinkId: null,
              },
            ])
          },
        })
      },
    },
    hasPasteData &&
      directoryId == null && {
        action: 'paste',
        doAction: () => {
          doPaste(currentDirectoryId)
        },
      },
  ])
}
