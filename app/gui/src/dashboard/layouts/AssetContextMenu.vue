<script setup lang="ts">
/**
 * @file The context menu of one asset. Its entries are also the asset table's shortcuts while one
 * asset is selected (`useMenuEntries`, scoped to the table), and the command palette's actions.
 */
import ContextMenu from '#/components/ContextMenu.vue'
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import { useEditDatalink } from '#/layouts/Drive/datalinkActions'
import { useExportArchive, useMutationCallback, useNewProject } from '#/layouts/Drive/driveActions'
import { canDownloadAsset } from '#/layouts/Drive/downloadEntry'
import { useDriveView } from '#/layouts/Drive/driveView'
import { useGlobalContextMenuEntries } from '#/layouts/Drive/globalContextMenuEntries'
import ManageLabelsModal from '#/components/labels/ManageLabelsModal.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import { useCopy } from '$/components/Button/copy'
import { useMenuEntries } from '$/composables/menuEntries'
import type { DashboardBindingKey } from '$/configurations/inputBindings'
import { useBackends } from '$/providers/backends'
import { isRecentCategory, useCategories } from '$/providers/category'
import { useContainerData, type Tab } from '$/providers/container'
import { useDriveStore } from '$/providers/driveStore'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import {
  copyAssetsMutationOptions,
  deleteAssetsMutationOptions,
  downloadAssetsMutationOptions,
} from '$/utils/driveMutations'
import * as backendModule from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { asset, currentDirectoryId, bindingTarget, position, doCopy, doCut, doPaste } = defineProps<{
  asset: backendModule.AnyAsset
  currentDirectoryId: backendModule.DirectoryId
  position: Pick<MouseEvent, 'pageX' | 'pageY'>
  /** The element whose keys the entries' shortcuts act on: the assets table. */
  bindingTarget: HTMLElement | null | undefined
  doCopy: () => void
  doCut: () => void
  doPaste: (newParentId: backendModule.DirectoryId) => void
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{ close: [] }>()

const { getText } = useText()
const categories = useCategories()
const container = useContainerData()
const openedProjects = useOpenedProjects()
const driveStore = useDriveStore()
const driveView = useDriveView()
const modals = useModals()
const { localBackend } = useBackends()
const showDeveloperIds = useFeatureFlag('showDeveloperIds')

const category = computed(() => driveView.location.category)
const backend = computed(() => driveView.location.backend)

const editDatalink = useEditDatalink(backend)
const deleteAssets = useMutationCallback(() => deleteAssetsMutationOptions(backend.value))
const copyAssets = useMutationCallback(() => copyAssetsMutationOptions(backend.value))
const downloadAssets = useMutationCallback(() => downloadAssetsMutationOptions(backend.value))
const { copy } = useCopy()
const exportArchive = useExportArchive(backend, driveStore)
const newProject = useNewProject(backend, () => category.value.type)

const encodedEnsoPath = computed(() => encodeURI(asset.ensoPath))
const canOpenLocally = computed(() => container.canOpenProjectLocally(backend.value.type))
const disabledTooltip = computed(() =>
  !canOpenLocally.value ? getText('downloadToOpenWorkflow') : undefined,
)

/**
 * This asset's row in the table: the one right-clicked, or, when the entry is used as a shortcut or
 * from the command palette, the row showing it.
 */
function assetRow(): HTMLElement | null {
  const clicked = driveStore.contextMenuData?.trigger
  if (clicked?.dataset.id === asset.id) return clicked
  return (
    bindingTarget?.querySelector<HTMLElement>(
      `[data-testid="asset-row"][data-id="${CSS.escape(asset.id)}"]`,
    ) ?? null
  )
}

const canAddToThisDirectory = computed(
  () => !isRecentCategory(category.value) && asset.type === backendModule.AssetType.directory,
)

const hasPasteData = computed(() => (driveStore.pasteData?.data.assets.length ?? 0) > 0)
const isRunningProject = computed(
  () =>
    asset.type === backendModule.AssetType.project &&
    backendModule.IS_OPENING_OR_OPENED[asset.projectState.type],
)
const globalContextMenuEntries = useGlobalContextMenuEntries({
  backend,
  category: () => category.value.type,
  currentDirectoryId: () => currentDirectoryId,
  directoryId: () => (canAddToThisDirectory.value ? (asset.id as backendModule.DirectoryId) : null),
  doPaste: (id) => doPaste(id),
})

const systemApi = window.api?.system

const entries = computed((): (ContextMenuEntry | false | null | undefined)[] => {
  const pasteMenuEntry: ContextMenuEntry | false = hasPasteData.value && {
    action: 'paste',
    doAction: () => {
      const directoryId =
        asset.type === backendModule.AssetType.directory ? asset.id : asset.parentId
      doPaste(directoryId)
    },
  }
  const copyIdEntry: ContextMenuEntry | false = showDeveloperIds.value && {
    color: 'accent',
    action: 'copyId',
    doAction: () => {
      void copy(asset.id)
    },
  }

  return [
    (asset.type === backendModule.AssetType.datalink ||
      asset.type === backendModule.AssetType.file) && {
      action: 'useInNewProject',
      doAction: () => {
        void newProject({ templateName: asset.title, ensoPath: asset.ensoPath }, asset.parentId)
      },
    },
    asset.type === backendModule.AssetType.project &&
      !isRunningProject.value && {
        action: 'open',
        isDisabled: !canOpenLocally.value,
        tooltip: disabledTooltip.value,
        doAction: () => {
          container.openProjectLocally(asset, backend.value.type)
        },
      },
    asset.type === backendModule.AssetType.project &&
      isRunningProject.value && {
        action: 'close',
        doAction: () => {
          const tab: Tab = { type: 'project', id: asset.id }
          if (container.isTabOpened(tab)) container.closeTab(tab)
          // With no tab open, close it on the backend.
          else openedProjects.closeProject(asset.id, asset)
        },
      },
    backend.value.supportsLabels(asset.type) && {
      action: 'label',
      doAction: () => {
        // It replaces the open modals. It is anchored to the asset's row, and focus returns there.
        const row = assetRow()
        modals.closeAll()
        modals.open(ManageLabelsModal, {
          backend: backend.value,
          items: [asset],
          anchor: row,
          // Under the row's start, by the asset's name: the row is as wide as the table.
          placement: 'bottom-start',
          opener: row,
        })
      },
    },
    {
      action: 'copy',
      doAction: () => {
        doCopy()
      },
    },
    !isRunningProject.value && {
      action: 'cut',
      doAction: () => {
        doCut()
      },
    },
    pasteMenuEntry,
    canDownloadAsset(false, asset.type) && {
      isDisabled: asset.type === backendModule.AssetType.secret,
      action: 'download',
      doAction: () => {
        void downloadAssets({
          ids: [{ id: asset.id, title: asset.title }],
          targetDirectoryId: categories.categoryDirectoryId({ type: 'local' }),
          shouldUnpackProject: false,
        })
      },
    },
    !isRunningProject.value && {
      action: 'rename',
      doAction: () => {
        driveStore.update({ assetToRename: asset.id })
      },
    },
    asset.type === backendModule.AssetType.datalink && {
      action: 'edit',
      doAction: () => {
        void editDatalink(asset)
      },
    },
    asset.type === backendModule.AssetType.project && {
      action: 'duplicate',
      doAction: () => {
        void copyAssets([[asset.id], asset.parentId])
      },
    },
    {
      action: 'exportArchive',
      doAction: () => {
        void exportArchive()
      },
    },
    ...(canAddToThisDirectory.value ? globalContextMenuEntries.value : []),
    !isRunningProject.value && {
      action: 'delete',
      label: getText('deleteShortcut'),
      doAction: () => {
        modals.closeAll()
        modals.open(ConfirmDeleteModal, {
          actionText: getText(
            'deleteTheAssetTypeTitle',
            getText(backendModule.ASSET_TYPE_TO_TEXT_ID[asset.type]),
            asset.title,
          ),
          onConfirm: async () => {
            await deleteAssets([[asset.id], false])
          },
        })
      },
    },
    systemApi != null && {
      action: 'openInFileBrowser',
      doAction: () => {
        systemApi.showItemInFolder(encodedEnsoPath.value)
      },
    },
    {
      action: 'copyAsPath',
      doAction: () => {
        void copy(encodedEnsoPath.value)
      },
    },
    copyIdEntry,
  ]
})

/** The entries of the full list that local Recent keeps; it adds "Remove from Recent". */
const LOCAL_RECENT_ACTIONS: ReadonlySet<DashboardBindingKey> = new Set([
  'open',
  'close',
  'label',
  'openInFileBrowser',
  'copyId',
])
const forgetRecentProject = useMutationCallback(() => ({
  mutationFn: async (projectId: backendModule.ProjectId) => {
    await localBackend?.forgetRecentProject(projectId)
  },
  meta: {
    invalidates: [[backendModule.BackendType.local, 'listDirectory']],
    awaitInvalidates: true,
    refetchType: 'all' as const,
  },
}))
const shownEntries = computed((): (ContextMenuEntry | false | null | undefined)[] =>
  category.value.type !== 'localRecent' ?
    entries.value
  : [
      ...entries.value.filter((entry) => entry && LOCAL_RECENT_ACTIONS.has(entry.action)),
      asset.type === backendModule.AssetType.project &&
        localBackend != null && {
          action: 'removeFromRecent',
          doAction: () => {
            void forgetRecentProject(asset.id)
          },
        },
    ],
)

const presentEntries = useMenuEntries(shownEntries, () => bindingTarget)
</script>

<template>
  <ContextMenu
    v-model:open="open"
    :ariaLabel="getText('assetContextMenuLabel')"
    :entries="presentEntries"
    :position="position"
    @close="emit('close')"
  />
</template>
