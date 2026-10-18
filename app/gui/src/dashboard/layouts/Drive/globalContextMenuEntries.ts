/**
 * @file The context-menu entries available everywhere in a directory (upload, new project,
 * folder and datalink, and paste).
 */
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import type { CategoryType } from '$/providers/category'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import type { Backend, DirectoryId } from 'enso-common/src/services/Backend'
import { readUserSelectedFile } from 'enso-common/src/utilities/file'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useNewDatalink } from './datalinkActions'
import { useNewFolder, useNewProject, useUploadFiles } from './driveActions'

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
  const newDatalink = useNewDatalink(options.backend, options.category, driveStore)
  const newProject = useNewProject(options.backend, options.category)
  const uploadFiles = useUploadFiles(options.backend, options.category, driveStore)

  const hasPasteData = computed(() => (driveStore.pasteData?.data.assets.length ?? 0) > 0)

  return computed((): (ContextMenuEntry | false)[] => [
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
    {
      action: 'newDatalink',
      doAction: () => {
        modals.closeAll()
        newDatalink(target())
      },
    },
    hasPasteData.value &&
      toValue(options.directoryId) == null && {
        action: 'paste',
        doAction: () => {
          options.doPaste(toValue(options.currentDirectoryId))
        },
      },
  ])
}
