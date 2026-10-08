<script setup lang="ts">
/**
 * @file The labels column of the drive's table: the asset's labels (each removable), and a button
 * opening the labels popover for the asset, or for the whole selection when the asset is in it.
 *
 * Overflowing labels neither fade out nor offer a "show all labels" popover. Before the Vue port
 * (#75) the column had both, but its measurement never reported an overflow, so neither ever showed
 * (measured on the base: eight labels in a 348px cell); adding them is a visible change, for its
 * own issue.
 *
 * The labels popover (`ManageLabelsModal.vue`, #198) opens on the modal stack over the open
 * modals, anchored to the button. The button has no accessible name (axe's `button-name`, in the
 * drive's baseline); it has an id, so that axe names it by that (normalized) id as before.
 */
import { useMutationCallback, useToastAndLog } from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import DriveLabel from '#/pages/dashboard/components/DriveLabel.vue'
import ManageLabelsModal from '$/cloud/labels/ManageLabelsModal.vue'
import Button from '$/components/Button/Button.vue'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '$/utils/backendQuery'
import {
  FALLBACK_COLOR,
  type AnyAsset,
  type Label as BackendLabel,
  type LabelName,
} from 'enso-common/src/services/Backend'
import { computed, shallowRef, useId } from 'vue'

const { item, labels } = defineProps<{
  item: AnyAsset
  labels: readonly BackendLabel[]
}>()

const { getText } = useText()
const driveStore = useDriveStore()
const driveView = useDriveView()
const modals = useModals()
const toastAndLog = useToastAndLog()
const associateTag = useMutationCallback(() =>
  backendMutationOptions(driveView.location.backend, 'associateTag'),
)

const editButtonId = useId()
const labelsByName = computed(() => new Map(labels.map((label) => [label.value, label])))
const shownLabels = computed(() =>
  (item.labels ?? []).filter((label) => labelsByName.value.has(label)),
)
/** The assets the labels popover is for: the selection, when this asset is in it. */
const labelsItems = computed(() =>
  driveStore.selectedAssets.some((asset) => asset.id === item.id) ?
    driveStore.selectedAssets
  : [item],
)

async function doDelete(label: LabelName) {
  modals.closeAll()
  const newLabels = item.labels?.filter((oldLabel) => oldLabel !== label) ?? []
  try {
    await associateTag([item.id, newLabels, item.title])
  } catch (error) {
    toastAndLog('deleteLabelBackendError', error, label)
  }
}

/** The stack entry of the labels popover this column opened, while it is open. */
const labelsModalKey = shallowRef<number | null>(null)
const isLabelsModalOpen = computed(
  () =>
    labelsModalKey.value != null &&
    modals.stack.value.some((entry) => entry.key === labelsModalKey.value),
)

function openLabelsModal(event: MouseEvent) {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const { key } = modals.open(ManageLabelsModal, {
    backend: driveView.location.backend,
    items: labelsItems.value,
    anchor: trigger,
  })
  labelsModalKey.value = key
}
</script>

<template>
  <div class="group relative flex items-center gap-1">
    <div class="flex h-6 items-center gap-1 overflow-hidden">
      <DriveLabel
        v-for="label in shownLabels"
        :key="label"
        active
        testId="asset-label"
        :title="getText('rightClickToRemoveLabel')"
        :color="labelsByName.get(label)?.color ?? FALLBACK_COLOR"
        :onDelete="() => doDelete(label)"
      >
        {{ label }}
      </DriveLabel>
    </div>
    <!-- Clicks here must not reach the row, which would select it. -->
    <div class="contents" @click.stop>
      <Button
        :id="editButtonId"
        variant="icon"
        showIconOnHover
        :tooltip="getText('manageLabels')"
        tooltipPlacement="top"
        icon="edit"
        :aria-expanded="isLabelsModalOpen"
        v-bind="STOP_PRESS_PROPAGATION"
        @press="openLabelsModal"
      />
    </div>
  </div>
</template>
