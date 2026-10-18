<script setup lang="ts">
/**
 * @file The drive: the bar (location, actions, search) and the table of the shown directory,
 * mounted by the left panel (`LeftPanel.vue`), with the `drive-view` test id and its
 * `data-category` (the category actually shown).
 *
 * It provides the drive's state (`provideDriveStore`, #90), the location it shows
 * (`provideDriveView`: the old directory stays on screen while a new one loads), the listed assets
 * and the search suggestions.
 */
import AssetsTable from '#/layouts/AssetsTable.vue'
import { provideAssetItems } from '#/layouts/Drive/assetItems'
import { provideDriveView } from '#/layouts/Drive/driveView'
import { provideSuggestions } from '#/layouts/Drive/suggestions'
import DriveBar from '#/pages/dashboard/Drive/DriveBar/DriveBar.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import ErrorDisplay from '$/components/ErrorBoundary/ErrorDisplay.vue'
import Loader from '$/components/Spinner/Loader.vue'
import { categoryKey } from '$/providers/category'
import { useContainerData } from '$/providers/container'
import { useDriveLocation } from '$/providers/drive'
import { provideDriveStore } from '$/providers/driveStore'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import AssetQuery from '$/utils/AssetQuery'
import { DirectoryDoesNotExistError } from 'enso-common/src/services/Backend'
import { OfflineError } from 'enso-common/src/utilities/errors'
import { computed, shallowRef, watch } from 'vue'
import OfflineMessage from './Drive/OfflineMessage.vue'

const { toolbar } = defineProps<{
  /** The panel's toolbar, where the drive's location goes. */
  toolbar: HTMLElement | null | undefined
}>()

provideDriveStore()
provideAssetItems()
provideSuggestions()
const driveView = provideDriveView()

const { getText } = useText()
const drive = useDriveLocation()
const container = useContainerData()
const toasts = useToasts()

// A directory that no longer exists sends the drive back to its default category, with a toast.
watch(
  () => driveView.error.value,
  (error) => {
    if (error instanceof DirectoryDoesNotExistError) {
      toasts.show(getText('directoryDoesNotExistError'), {
        type: 'error',
        toastId: 'directory-does-not-exist-error',
      })
      drive.setDefaultCategory()
    }
  },
)

const errorToShow = computed(() => {
  const error = driveView.error.value
  return error instanceof DirectoryDoesNotExistError ? null : error
})

const query = shallowRef(AssetQuery.fromString(''))
function setQuery(newQuery: AssetQuery) {
  query.value = newQuery
}

const shown = computed(() => driveView.shown.value)

function onFocusIn() {
  container.setFocusedPanel({ type: 'drive' })
}
</script>

<template>
  <ErrorBoundary>
    <OfflineMessage v-if="errorToShow instanceof OfflineError" :onPress="driveView.retry" />
    <ErrorDisplay v-else-if="errorToShow != null" :error="errorToShow" @reset="driveView.retry" />
    <Loader v-else-if="shown == null" minHeight="h24" size="medium" />
    <div
      v-else
      class="relative flex w-full grow flex-col overflow-hidden"
      data-testid="drive-view"
      :data-category="categoryKey(shown.category)"
      @focusin="onFocusIn"
    >
      <DriveBar :query="query" :setQuery="setQuery" :toolbar="toolbar" />
      <ErrorBoundary>
        <AssetsTable :query="query" />
      </ErrorBoundary>
    </div>
  </ErrorBoundary>
</template>
