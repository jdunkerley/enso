<script setup lang="ts">
/**
 * @file The drive: the bar (location, actions, search) and the table of the shown directory,
 * mounted by the left panel (`LeftPanel.vue`), with the `drive-view` test id and its
 * `data-category` (the category actually shown).
 *
 * It provides the drive's state (`provideDriveStore`, #90), the location it shows
 * (`provideDriveView`: the old directory stays on screen while a new one loads), the listed assets
 * and the search suggestions. In place of the drive it shows why the cloud is unavailable (the
 * cloud cannot be reached, or the user is not enabled), or that the cloud is unavailable offline.
 */
import AssetsTable from '#/layouts/AssetsTable.vue'
import { provideAssetItems } from '#/layouts/Drive/assetItems'
import { useToastAndLog } from '#/layouts/Drive/driveActions'
import { provideDriveView } from '#/layouts/Drive/driveView'
import { provideSuggestions } from '#/layouts/Drive/suggestions'
import DriveBar from '#/pages/dashboard/Drive/DriveBar/DriveBar.vue'
import { SUBSCRIBE_PATH } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import ErrorDisplay from '$/components/ErrorBoundary/ErrorDisplay.vue'
import Result from '$/components/Result/Result.vue'
import Loader from '$/components/Spinner/Loader.vue'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { categoryKey, isCloudCategory } from '$/providers/category'
import { useContainerData } from '$/providers/container'
import { useDriveLocation } from '$/providers/drive'
import { provideDriveStore } from '$/providers/driveStore'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import AssetQuery from '$/utils/AssetQuery'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'
import LocalStorage from '$/utils/LocalStorage'
import { BackendType, DirectoryDoesNotExistError } from 'enso-common/src/services/Backend'
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
const auth = useAuth()
const drive = useDriveLocation()
const container = useContainerData()
const isOnline = useIsOnline()
const toasts = useToasts()
const toastAndLog = useToastAndLog()
const { localBackend } = useBackends()
const localStorage = LocalStorage.getInstance()

const session = computed(() => auth.session)
const isCloud = computed(() => isCloudCategory(drive.currentCategory))
/**
 * Whether the user has chosen a category. While they have not, the cloud-unavailable stub shows
 * whichever category the default picked, so that a cloud failure is always surfaced; once they
 * have, the local categories work without the cloud.
 */
const hasExplicitCategory = computed(() => localStorage.get('driveDisplay') != null)
const supportLocalBackend = localBackend != null

const status = computed(() => {
  const currentSession = session.value
  // When authentication is disabled there is no cloud to retry: the user lands on the local drive.
  const showCloudUnavailableStub =
    currentSession?.isCloudDataUnavailable === true &&
    !currentSession.isAuthDisabled &&
    (isCloud.value || !hasExplicitCategory.value)
  return (
    isCloud.value && !isOnline.value ? 'offline'
    : showCloudUnavailableStub ? 'cloud-unavailable'
    : isCloud.value && currentSession?.user.isEnabled !== true ? 'not-enabled'
    : 'ok'
  )
})

function switchToLocal() {
  drive.currentCategory = { type: 'local' }
}

async function downloadFreeEdition() {
  const downloadUrl = await getDownloadUrl()
  if (downloadUrl == null) toastAndLog('noAppDownloadError')
  else void download({ url: downloadUrl })
}

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
const isInaccessible = computed(
  () => shown.value?.backend.type === BackendType.remote && !isOnline.value,
)

function onFocusIn() {
  container.setFocusedPanel({ type: 'drive' })
}
</script>

<template>
  <ErrorBoundary>
    <Result
      v-if="status === 'cloud-unavailable'"
      status="error"
      :title="getText('cloudDataUnavailableTitle')"
      testId="cloud-unavailable-stub"
      :subtitle="getText('cloudDataUnavailableSubtitle')"
    >
      <ButtonGroup align="center">
        <Button variant="primary" size="medium" @press="() => auth.refetchSession()">
          {{ getText('retry') }}
        </Button>
        <Button v-if="supportLocalBackend" size="medium" variant="outline" @press="switchToLocal">
          {{ getText('switchToLocal') }}
        </Button>
      </ButtonGroup>
    </Result>
    <Result
      v-else-if="status === 'not-enabled'"
      status="error"
      :title="getText('notEnabledTitle')"
      testId="not-enabled-stub"
      :subtitle="`${getText('notEnabledSubtitle')}${localBackend == null ? ' ' + getText('downloadFreeEditionMessage') : ''}`"
    >
      <ButtonGroup align="center">
        <Button variant="primary" size="medium" :href="SUBSCRIBE_PATH">
          {{ getText('upgrade') }}
        </Button>
        <Button v-if="supportLocalBackend" size="medium" variant="primary" @press="switchToLocal">
          {{ getText('switchToLocal') }}
        </Button>
        <Button
          v-else
          data-testid="download-free-edition"
          size="medium"
          variant="accent"
          @press="downloadFreeEdition"
        >
          {{ getText('downloadFreeEdition') }}
        </Button>
      </ButtonGroup>
    </Result>
    <template v-else>
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
        <OfflineMessage v-if="isInaccessible" />
        <ErrorBoundary v-else>
          <AssetsTable :query="query" />
        </ErrorBoundary>
      </div>
    </template>
  </ErrorBoundary>
</template>
