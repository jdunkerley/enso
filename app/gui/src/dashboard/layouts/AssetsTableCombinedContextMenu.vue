<script setup lang="ts">
/**
 * @file The asset table's context menu: one asset's (`AssetContextMenu.vue`) while exactly one is
 * selected, else the table's (`AssetsTableContextMenu.vue`). The Vue port of React's
 * `AssetsTableCombinedContextMenu`.
 *
 * It keeps where the menu is and whether it is open, which React kept in each menu: when the kind
 * of menu changes (a right click on a row that was not selected selects it), the new one opens
 * only where the row's right click asked for it (`contextMenuData`), as React's freshly mounted
 * menu did. `open` and `close` are React's imperative `ContextMenuApi`.
 */
import AssetContextMenu from '#/layouts/AssetContextMenu.vue'
import AssetsTableContextMenu from '#/layouts/AssetsTableContextMenu.vue'
import { useAssetItems } from '#/layouts/Drive/assetItems'
import { useDriveStore } from '$/providers/driveStore'
import type { DirectoryId } from 'enso-common/src/services/Backend'
import { computed, ref, shallowRef, watch } from 'vue'

const { currentDirectoryId, bindingTarget, doCopy, doCut, doPaste } = defineProps<{
  currentDirectoryId: DirectoryId
  bindingTarget: HTMLElement | null | undefined
  doCopy: () => void
  doCut: () => void
  doPaste: (newParentId: DirectoryId) => void
}>()

const driveStore = useDriveStore()
const assetItems = useAssetItems()

/** The one selected asset, when exactly one is selected and listed. */
const asset = computed(() => {
  const { selectedIds } = driveStore
  if (selectedIds.size !== 1) return undefined
  const [soleId] = selectedIds
  return soleId != null ? assetItems.getAsset(soleId) : undefined
})
const kind = computed(() => (asset.value != null ? 'asset' : 'table'))

const isOpen = ref(false)
const position = shallowRef<Pick<MouseEvent, 'pageX' | 'pageY'>>({ pageX: 0, pageY: 0 })

watch(kind, (newKind) => {
  const initialPosition =
    newKind === 'asset' ? driveStore.contextMenuData?.initialContextMenuPosition : null
  if (initialPosition != null) {
    position.value = initialPosition
    isOpen.value = true
  } else {
    isOpen.value = false
  }
})

defineExpose({
  /** Open the menu at a point in page coordinates. */
  open(newPosition: Pick<MouseEvent, 'pageX' | 'pageY'>) {
    position.value = { pageX: newPosition.pageX, pageY: newPosition.pageY }
    isOpen.value = true
  },
  close() {
    isOpen.value = false
  },
})
</script>

<template>
  <AssetContextMenu
    v-if="asset != null"
    v-model:open="isOpen"
    :asset="asset"
    :position="position"
    :currentDirectoryId="currentDirectoryId"
    :bindingTarget="bindingTarget"
    :doCopy="doCopy"
    :doCut="doCut"
    :doPaste="doPaste"
    @close="driveStore.update({ contextMenuData: null })"
  />
  <AssetsTableContextMenu
    v-else
    v-model:open="isOpen"
    :position="position"
    :currentDirectoryId="currentDirectoryId"
    :bindingTarget="bindingTarget"
    :doCopy="doCopy"
    :doCut="doCut"
    :doPaste="doPaste"
  />
</template>
