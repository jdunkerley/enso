<script setup lang="ts">
/**
 * @file The context menu of the asset table when no asset, or several, are selected. Its entries
 * are also the table's shortcuts meanwhile (`useMenuEntries`, scoped to the table), and the command
 * palette's actions.
 */
import ContextMenu from '#/components/ContextMenu.vue'
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import { useAssetItems } from '#/layouts/Drive/assetItems'
import { useExportArchive, useMutationCallback } from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import { useGlobalContextMenuEntries } from '#/layouts/Drive/globalContextMenuEntries'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import { useCopy } from '$/components/Button/copy'
import { useMenuEntries } from '$/composables/menuEntries'
import { canTransferBetweenCategories, isRecentCategory } from '$/providers/category'
import { useDriveStore } from '$/providers/driveStore'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { deleteAssetsMutationOptions } from '$/utils/driveMutations'
import * as backendModule from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { currentDirectoryId, bindingTarget, position, doCut, doPaste } = defineProps<{
  currentDirectoryId: backendModule.DirectoryId
  /** The element whose keys the entries' shortcuts act on: the assets table. */
  bindingTarget: HTMLElement | null | undefined
  position: Pick<MouseEvent, 'pageX' | 'pageY'>
  doCut: () => void
  doPaste: (newParentId: backendModule.DirectoryId) => void
}>()

const open = defineModel<boolean>('open', { required: true })

const { getText } = useText()
const driveStore = useDriveStore()
const driveView = useDriveView()
const assetItems = useAssetItems()
const modals = useModals()
const showDeveloperIds = useFeatureFlag('showDeveloperIds')
const { copy } = useCopy()

const category = computed(() => driveView.location.category)
const backend = computed(() => driveView.location.backend)
const selectedAssets = computed(() => driveStore.selectedAssets)

const deleteAssets = useMutationCallback(() => deleteAssetsMutationOptions(backend.value))
const exportArchive = useExportArchive(backend, driveStore)

const globalContextMenuEntries = useGlobalContextMenuEntries({
  backend,
  category: () => category.value.type,
  currentDirectoryId: () => currentDirectoryId,
  directoryId: null,
  doPaste: (id) => doPaste(id),
})

/** Whether there is something to paste here: cut or copied assets this category can take. */
const hasPasteData = computed(() => {
  const pasteData = driveStore.pasteData
  const effectivePasteData =
    (
      pasteData?.data.backendType === backend.value.type &&
      canTransferBetweenCategories(pasteData.data.category, category.value)
    ) ?
      pasteData
    : null
  return (effectivePasteData?.data.assets.length ?? 0) > 0
})

function doDeleteAll() {
  const selectedIds = selectedAssets.value.map((asset) => asset.id)
  const firstKey = selectedIds[0]
  const soleAssetName =
    firstKey != null ? (assetItems.getAsset(firstKey)?.title ?? '(unknown)') : '(unknown)'
  modals.closeAll()
  modals.open(ConfirmDeleteModal, {
    actionText:
      selectedIds.length === 1 ?
        getText('deleteSelectedAssetActionText', soleAssetName)
      : getText('deleteSelectedAssetsActionText', selectedIds.length),
    onConfirm: async () => {
      driveStore.setSelectedAssets([])
      await deleteAssets([selectedIds, false])
    },
  })
}

const entries = computed((): (ContextMenuEntry | false | null | undefined)[] => {
  const selected = selectedAssets.value
  const copyIdsMenuEntry: ContextMenuEntry | false = showDeveloperIds.value && {
    action: 'copyId',
    color: 'accent',
    doAction: () => {
      void copy(selected.map((asset) => asset.id).join('\n'))
    },
  }
  const pasteAllMenuEntry: ContextMenuEntry | false = hasPasteData.value && {
    action: 'paste',
    doAction: () => {
      const first = selected[0]
      const id = first?.type === backendModule.AssetType.directory ? first.id : currentDirectoryId
      doPaste(id)
    },
  }

  if (isRecentCategory(category.value)) return [copyIdsMenuEntry]
  return [
    selected.length !== 0 && {
      action: 'exportArchive',
      doAction: () => {
        void exportArchive()
      },
    },
    selected.length !== 0 && {
      action: 'cut',
      doAction: () => {
        doCut()
      },
    },
    pasteAllMenuEntry,
    ...globalContextMenuEntries.value,
    selected.length !== 0 && {
      action: 'delete',
      label: getText('deleteShortcut'),
      doAction: () => {
        doDeleteAll()
      },
    },
    copyIdsMenuEntry,
  ]
})

const presentEntries = useMenuEntries(entries, () => bindingTarget)
</script>

<template>
  <ContextMenu
    v-model:open="open"
    :ariaLabel="getText('assetsTableContextMenuLabel')"
    :entries="presentEntries"
    :position="position"
  />
</template>
