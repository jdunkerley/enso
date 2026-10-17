<script setup lang="ts">
/**
 * @file The drive's toolbar: the buttons creating assets (a project, a folder), uploading and
 * downloading, the count of cut or copied assets, and the search bar. In the trash, a button
 * emptying it; in Recent, only the count and the search bar.
 */
import AssetSearchBar from '#/layouts/AssetSearchBar.vue'
import {
  useExportArchive,
  useMutationCallback,
  useNewFolder,
  useNewProject,
  useUploadFiles,
} from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import { useVisualTooltip } from '$/components/Tooltip/useVisualTooltip'
import VisualTooltipPopup from '$/components/Tooltip/VisualTooltipPopup.vue'
import { canTransferBetweenCategories, isRecentCategory, useCategories } from '$/providers/category'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import type AssetQuery from '$/utils/AssetQuery'
import { deleteAssetsMutationOptions, downloadAssetsMutationOptions } from '$/utils/driveMutations'
import { getAllTrashedItems, listDirectoryQueryOptions } from '$/utils/driveQueries'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { BackendType, isDirectoryId, isProjectId } from 'enso-common/src/services/Backend'
import { readUserSelectedFile } from 'enso-common/src/utilities/file'
import { computed, ref } from 'vue'
import PasteStatus from './PasteStatus.vue'

const { query, setQuery } = defineProps<{
  query: AssetQuery
  setQuery: (query: AssetQuery) => void
}>()

const { getText } = useText()
const categories = useCategories()
const driveStore = useDriveStore()
const driveView = useDriveView()
const modals = useModals()
const isOnline = useIsOnline()
const queryClient = useQueryClient()

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

// === The trash ===

const trashCategory = { type: 'trash' } as const
const trashListing = useQuery(
  computed(() => ({
    ...listDirectoryQueryOptions({
      backend: backend.value,
      category: trashCategory,
      parentId: categories.categoryDirectoryId(trashCategory),
      refetchInterval: null,
      labels: null,
      sortDirection: null,
      sortExpression: null,
    }),
    enabled: category.value.type === 'trash',
  })),
)
const isTrashEmpty = computed(() => (trashListing.data.value?.assets.length ?? 0) === 0)
const deleteAssets = useMutationCallback(() => deleteAssetsMutationOptions(backend.value))
const clearTrashKey = ref<number | null>(null)
const isClearTrashOpen = computed(
  () =>
    clearTrashKey.value != null &&
    modals.stack.value.some((entry) => entry.key === clearTrashKey.value),
)

function openClearTrash() {
  const { key } = modals.open(ConfirmDeleteModal, {
    actionText: getText('allTrashedItemsForever'),
    onConfirm: async () => {
      const allTrashedItems = await getAllTrashedItems(
        queryClient,
        backend.value,
        categories.categoryDirectoryId(trashCategory),
      )
      await deleteAssets([allTrashedItems.map((item) => item.id), true])
    },
  })
  clearTrashKey.value = key
}
</script>

<template>
  <ButtonGroup v-if="isRecentCategory(category)" class="grow-0">
    <PasteStatus v-if="effectivePasteData" :pasteData="effectivePasteData" />
    <AssetSearchBar :backend="backend" :isCloud="isCloud" :query="query" :setQuery="setQuery" />
  </ButtonGroup>
  <ErrorBoundary v-else-if="category.type === 'trash'">
    <ButtonGroup class="grow-0" :buttonVariants="{ isDisabled: shouldBeDisabled }">
      <Button
        size="medium"
        variant="outline"
        :isDisabled="isTrashEmpty"
        :aria-expanded="isClearTrashOpen"
        @press="openClearTrash"
      >
        {{ getText('clearTrash') }}
      </Button>
      <PasteStatus v-if="effectivePasteData" :pasteData="effectivePasteData" />
      <AssetSearchBar :backend="backend" :isCloud="isCloud" :query="query" :setQuery="setQuery" />
    </ButtonGroup>
  </ErrorBoundary>
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
