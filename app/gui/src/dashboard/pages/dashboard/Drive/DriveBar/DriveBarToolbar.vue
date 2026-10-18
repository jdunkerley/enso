<script setup lang="ts">
/**
 * @file The drive's toolbar: the buttons creating assets (a project, a folder, a datalink, which
 * opens the datalink dialog on the modal stack), uploading and downloading, the count of cut or
 * copied assets, and the search bar. In Recent, only the count and the search bar.
 */
import AssetSearchBar from '#/layouts/AssetSearchBar.vue'
import { useNewDatalink } from '#/layouts/Drive/datalinkActions'
import {
  useExportArchive,
  useMutationCallback,
  useNewFolder,
  useNewProject,
  useUploadFiles,
} from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import { useVisualTooltip } from '$/components/Tooltip/useVisualTooltip'
import VisualTooltipPopup from '$/components/Tooltip/VisualTooltipPopup.vue'
import { canTransferBetweenCategories, isRecentCategory } from '$/providers/category'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import type AssetQuery from '$/utils/AssetQuery'
import { downloadAssetsMutationOptions } from '$/utils/driveMutations'
import { BackendType, isDirectoryId, isProjectId } from 'enso-common/src/services/Backend'
import { readUserSelectedFile } from 'enso-common/src/utilities/file'
import { computed, ref, shallowRef } from 'vue'
import PasteStatus from './PasteStatus.vue'

const { query, setQuery } = defineProps<{
  query: AssetQuery
  setQuery: (query: AssetQuery) => void
}>()

const { getText } = useText()
const driveStore = useDriveStore()
const driveView = useDriveView()
const modals = useModals()
const isOnline = useIsOnline()

const category = computed(() => driveView.location.category)
const backend = computed(() => driveView.location.backend)
const currentDirectoryId = computed(() => driveView.location.currentDirectoryId)
const isCloud = computed(() => backend.value.type === BackendType.remote)
const shouldBeDisabled = computed(() => isCloud.value && !isOnline.value)
const error = computed(() => (shouldBeDisabled.value ? getText('cannotCreateAssetsHere') : null))

const createAssetButtons = ref<InstanceType<typeof ButtonGroup>>()
const createAssetButtonsElement = computed(
  () => (createAssetButtons.value?.$el as HTMLElement | undefined) ?? null,
)
const {
  isOpen: isCreateAssetsTooltipOpen,
  onTooltipEnter,
  onTooltipLeave,
} = useVisualTooltip(createAssetButtonsElement, { isDisabled: () => error.value == null })

const effectivePasteData = computed(() => {
  const pasteData = driveStore.pasteData
  return (
      pasteData?.data.backendType === backend.value.type &&
        canTransferBetweenCategories(pasteData.data.category, category.value)
    ) ?
      pasteData
    : null
})

const downloadAssets = useMutationCallback(() => downloadAssetsMutationOptions(backend.value))
const newFolder = useNewFolder(backend, () => category.value.type, driveStore)
const uploadFiles = useUploadFiles(backend, () => category.value.type, driveStore)
const newProjectRaw = useNewProject(backend, () => category.value.type)
const exportArchive = useExportArchive(backend, driveStore)
const newDatalink = useNewDatalink(backend, () => category.value.type, driveStore)
/** Key of the datalink dialog this button opened on the modal stack, for its `aria-expanded`. */
const openedDatalinkModal = shallowRef<number>()
const isDatalinkModalOpen = computed(() => {
  const key = openedDatalinkModal.value
  return key != null && modals.stack.value.some((entry) => entry.key === key)
})
function openNewDatalink() {
  openedDatalinkModal.value = newDatalink(currentDirectoryId.value).key
}
const newProject = useMutationCallback({
  mutationKey: ['newProject'],
  mutationFn: async () => await newProjectRaw({}, currentDirectoryId.value),
})

async function uploadFilesFromDialog() {
  const files = await readUserSelectedFile({ multiple: true })
  await uploadFiles(Array.from(files), currentDirectoryId.value)
}

function downloadFiles() {
  modals.closeAll()
  const { selectedAssets } = driveStore.state
  const sole = selectedAssets[0]
  if (
    selectedAssets.length === 1 &&
    sole != null &&
    (isCloud.value ? !isDirectoryId(sole.id) : isProjectId(sole.id))
  ) {
    void downloadAssets({ ids: selectedAssets, targetDirectoryId: null })
  } else {
    void exportArchive()
  }
}
</script>

<template>
  <ButtonGroup v-if="isRecentCategory(category)" class="grow-0">
    <PasteStatus v-if="effectivePasteData" :pasteData="effectivePasteData" />
    <AssetSearchBar :backend="backend" :isCloud="isCloud" :query="query" :setQuery="setQuery" />
  </ButtonGroup>
  <div v-else class="flex w-full flex-1 shrink-0 gap-2">
    <ButtonGroup
      ref="createAssetButtons"
      class="grow-0"
      :buttonVariants="{ isDisabled: shouldBeDisabled }"
    >
      <Button
        variant="accent"
        icon="add"
        loaderPosition="icon"
        @press="() => newProject(undefined)"
      >
        {{ getText('newEmptyProject') }}
      </Button>
      <div
        class="flex h-row items-center gap-4 rounded-full border-0.5 border-primary/20 px-[11px]"
      >
        <Button
          variant="icon"
          size="medium"
          icon="folder_add"
          :aria-label="getText('newFolder')"
          @press="() => newFolder(currentDirectoryId)"
        />
        <Button
          variant="icon"
          size="medium"
          icon="connector_add"
          :aria-expanded="isDatalinkModalOpen"
          :aria-label="getText('newDatalink')"
          @press="openNewDatalink"
        />
      </div>
      <div
        class="flex h-row items-center gap-4 rounded-full border-0.5 border-primary/20 px-[11px]"
      >
        <Button
          variant="icon"
          size="medium"
          icon="data_upload"
          :aria-label="getText('uploadFiles')"
          @press="uploadFilesFromDialog"
        />
        <Button
          :isDisabled="!driveStore.canDownload"
          variant="icon"
          size="medium"
          icon="data_download"
          :aria-label="getText('downloadFiles')"
          @press="downloadFiles"
        />
      </div>
      <VisualTooltipPopup
        v-if="error != null"
        :target="createAssetButtonsElement"
        :open="isCreateAssetsTooltipOpen"
        placement="top"
        @pointerenter="onTooltipEnter"
        @pointerleave="onTooltipLeave"
      >
        {{ error }}
      </VisualTooltipPopup>
    </ButtonGroup>
    <PasteStatus v-if="effectivePasteData" :pasteData="effectivePasteData" />
    <AssetSearchBar :backend="backend" :isCloud="isCloud" :query="query" :setQuery="setQuery" />
  </div>
</template>
