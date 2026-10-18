<script setup lang="ts">
/**
 * @file The "new version available" dialog (#83), which `App.vue` mounts while
 * `useVersionCheckerEnabled` holds.
 *
 * It fetches the latest release of this fork (`RELEASES_REPOSITORY`, #180) once a day, or ten
 * minutes after a failed request. When there is none, or the request fails (offline, rate-limited),
 * it stays quiet: no dialog, no toast, no retry before the next check. When the release is newer
 * than this build (and this build is neither a development nor a nightly one), it asks the user to
 * download it, or to be reminded later, which hides it until the next check. After "Download" it
 * thanks the user and can be closed. Tests can force it open with `useDevtoolsStore().showVersionChecker`.
 *
 * Where the app can update itself (the Electron updater's `auto` mode, #256) it asks the updater
 * instead of GitHub: the user chooses "Update" (nothing downloads before that), sees the progress,
 * then "Restart to update". A failed download offers "Retry" and "Download manually", the latter
 * being the flow above.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import StepContent from '$/components/Stepper/StepContent.vue'
import Stepper from '$/components/Stepper/Stepper.vue'
import { useStepperState } from '$/components/Stepper/useStepperState'
import Text from '$/components/Text/Text.vue'
import TextGroup from '$/components/Text/TextGroup.vue'
import { useDevtoolsStore } from '$/providers/devTools'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { useIncludePrereleases } from '$/providers/updateSettings'
import { download } from '$/utils/download'
import { getDownloadUrl, getLatestRelease, RELEASES_REPOSITORY } from '$/utils/github'
import { openInNewBrowserTab } from '$/utils/window'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, onScopeDispose, ref, watch, watchEffect } from 'vue'
import { useAutoUpdate } from './appUpdate'
import { getVersionNumber, isNewerRelease } from './versionChecker'

const STALE_TIME = 24 * 60 * 60 * 1000 // 1 day
const AUTO_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 1 day
const STALE_TIME_ERROR = 10 * 60 * 1000 // 10 minutes
const QUERY_KEY = ['latestRelease']

/** The latest release, as cached: `isPostponed` once the user asked to be reminded later. */
type CachedRelease = NonNullable<Awaited<ReturnType<typeof getLatestRelease>>> & {
  readonly isPostponed: boolean
}

const currentVersion: string = $config.VERSION ?? 'unknown-dev'

const text = useText()
const { getText } = text
const toasts = useToasts()
const devtools = useDevtoolsStore()
const queryClient = useQueryClient()

const autoUpdate = useAutoUpdate()

function checkAuto() {
  autoUpdate.check().catch((error) => console.error('Checking for an update failed:', error))
}
function downloadAuto() {
  autoUpdate.download().catch((error) => console.error('Downloading the update failed:', error))
}

let autoCheckTimer: ReturnType<typeof setInterval> | undefined
watch(
  autoUpdate.mode,
  (mode) => {
    if (mode !== 'auto' || autoCheckTimer != null) return
    checkAuto()
    autoCheckTimer = setInterval(checkAuto, AUTO_CHECK_INTERVAL)
  },
  { immediate: true },
)
onScopeDispose(() => clearInterval(autoCheckTimer))

// Switching prereleases on looks for one at once, not at the next daily check.
const includePrereleases = useIncludePrereleases()
watch(includePrereleases, (include) => {
  if (include && autoUpdate.mode.value === 'auto') checkAuto()
})

const shouldOverride = computed(() => devtools.showVersionChecker ?? false)

const metadataQuery = useQuery({
  queryKey: QUERY_KEY,
  enabled: computed(() => autoUpdate.mode.value === 'manual'),
  queryFn: async (): Promise<CachedRelease | null> => {
    const latest = await getLatestRelease()
    return latest && { ...latest, isPostponed: false }
  },
  select: (data: CachedRelease | null) => {
    if (data == null) return null
    const versionNumber = getVersionNumber(data.tag_name)
    const publishedAt = new Date(data.published_at).toLocaleString(text.locale, {
      dateStyle: 'long',
    })
    return {
      publishedAt,
      tagName: versionNumber == null ? currentVersion : data.tag_name,
      htmlUrl: data.html_url,
      isPostponed: data.isPostponed,
    }
  },
  meta: { persist: false },
  // A failed check is retried at the next one (`STALE_TIME_ERROR`), not at once.
  retry: false,
  staleTime: (query) => (query.state.error ? STALE_TIME_ERROR : STALE_TIME),
})

const { stepperState, isLastStep, resetStepper, nextStep } = useStepperState({ steps: 2 })

const isOpen = ref(false)

/** The release to tell the user about, or `null` while the dialog should not show. */
const release = computed(() => {
  const data = metadataQuery.data.value
  if (!metadataQuery.isSuccess.value || data == null || data.isPostponed) return null
  return shouldOverride.value || isNewerRelease(data.tagName, currentVersion) ? data : null
})

/** The update the updater is offering or has fetched, or `null` while the dialog should not show. */
const autoRelease = computed(() => {
  const s = autoUpdate.status.value
  return (
      s.state === 'available' ||
        s.state === 'downloading' ||
        s.state === 'ready' ||
        (s.state === 'error' && s.version != null)
    ) ?
      s
    : null
})
/** The version the user asked to be reminded about later (in the `available` state only). */
let postponedAutoVersion: string | null = null

const autoReleaseUrl = computed(() => {
  const version = autoRelease.value?.version
  return version == null ?
      `https://github.com/${RELEASES_REPOSITORY}/releases`
    : `https://github.com/${RELEASES_REPOSITORY}/releases/tag/${version}`
})

const autoReleaseDate = computed(() => {
  const r = autoRelease.value
  if (r?.state !== 'available') return null
  const date = new Date(r.releaseDate)
  return r.releaseDate === '' || Number.isNaN(date.getTime()) ?
      null
    : date.toLocaleString(text.locale, { dateStyle: 'long' })
})

const autoTitle = computed(() => {
  switch (autoRelease.value?.state) {
    case 'downloading':
      return getText('updateDownloadingTitle')
    case 'ready':
      return getText('updateReadyTitle')
    case 'error':
      return getText('updateFailedTitle')
    default:
      return getText('versionOutdatedTitle')
  }
})

// Open the dialog whenever the update moves on (or on first sight, as in a reloaded window), unless
// the user postponed this very version while it was only available. Closing it while downloading
// leaves it closed until the download is `ready` or fails.
watch(
  () => {
    const r = autoRelease.value
    return r == null ? null : `${r.state}/${r.version}`
  },
  (key) => {
    const r = autoRelease.value
    if (key == null || r == null) return
    if (r.state !== 'available') postponedAutoVersion = null
    else if (postponedAutoVersion === r.version) return
    isOpen.value = true
  },
  { immediate: true },
)

watchEffect(() => {
  if (release.value != null && !isOpen.value && !isLastStep.value) isOpen.value = true
})

function remindLater() {
  isOpen.value = false
  // The user asked to be reminded later: hide the dialog until the next check, a day from now.
  const cached = queryClient.getQueryData<CachedRelease>(QUERY_KEY)
  if (cached != null) {
    queryClient.setQueryData<CachedRelease>(QUERY_KEY, { ...cached, isPostponed: true })
  }
}

async function onDownload() {
  const downloadUrl = await getDownloadUrl()
  if (downloadUrl == null) {
    const message = `${getText('noAppDownloadError')}.`
    toasts.show(message, { type: 'error' })
    console.error(message)
  } else {
    void download({ url: downloadUrl })
    nextStep()
  }
}

function remindLaterAuto() {
  const r = autoRelease.value
  if (r?.state === 'available') postponedAutoVersion = r.version
  isOpen.value = false
}

/** Open the release page of the version that failed to download. */
function onDownloadManually() {
  openInNewBrowserTab(autoReleaseUrl.value)
}

/** The automatic-update dialog closed itself (its close button, Escape, an outside click). */
function onAutoOpenChange(open: boolean) {
  if (!open) remindLaterAuto()
  else isOpen.value = true
}

/** The dialog closed itself: on the last step (its close button, Escape, an outside click). */
function onOpenChange(open: boolean) {
  if (!open && devtools.showVersionChecker === true) devtools.showVersionChecker = false
  if (!isLastStep.value) remindLater()
  resetStepper()
  isOpen.value = open
}
</script>

<template>
  <Dialog
    v-if="autoRelease"
    :open="isOpen"
    :title="autoTitle"
    size="large"
    @update:open="onAutoOpenChange"
  >
    <div class="flex flex-col">
      <template v-if="autoRelease.state === 'available'">
        <Text class="text-center text-sm" balance>{{ getText('versionOutdatedPrompt') }}</Text>
        <div class="mb-4 mt-3 flex flex-col items-center">
          <TextGroup>
            <Text variant="h1">
              {{
                autoReleaseDate == null ?
                  autoRelease.version
                : getText('latestVersion', autoRelease.version, autoReleaseDate)
              }}
            </Text>
            <Button
              variant="link"
              :href="autoReleaseUrl"
              target="_blank"
              icon="open"
              iconPosition="end"
            >
              {{ getText('changeLog') }}
            </Button>
            <Text variant="body-sm">
              {{ getText('yourVersion') }}
              <Text weight="bold" variant="body">{{ currentVersion }}</Text>
            </Text>
          </TextGroup>
        </div>
        <ButtonGroup class="justify-center">
          <Button
            size="medium"
            variant="outline"
            fullWidth
            icon="time"
            iconPosition="end"
            @press="remindLaterAuto"
          >
            {{ getText('remindMeLater') }}
          </Button>
          <Button
            size="medium"
            fullWidth
            variant="primary"
            icon="data_download"
            iconPosition="end"
            @press="downloadAuto"
          >
            {{ getText('updateNow') }}
          </Button>
        </ButtonGroup>
      </template>

      <div v-else-if="autoRelease.state === 'downloading'" class="flex flex-col items-center gap-3">
        <Text variant="body">
          {{ getText('updateDownloading', Math.round(autoRelease.percent)) }}
        </Text>
        <progress class="w-full" :value="autoRelease.percent" max="100" />
      </div>

      <template v-else-if="autoRelease.state === 'ready'">
        <Text class="mb-4 text-center" balance variant="body">
          {{ getText('updateReady', autoRelease.version) }}
        </Text>
        <ButtonGroup class="justify-center">
          <Button
            size="medium"
            variant="outline"
            fullWidth
            icon="time"
            iconPosition="end"
            @press="remindLaterAuto"
          >
            {{ getText('remindMeLater') }}
          </Button>
          <Button size="medium" fullWidth variant="primary" @press="autoUpdate.restart()">
            {{ getText('restartToUpdate') }}
          </Button>
        </ButtonGroup>
      </template>

      <template v-else-if="autoRelease.state === 'error'">
        <Text class="mb-4 text-center" balance variant="body">
          {{ getText('updateFailed', autoRelease.message) }}
        </Text>
        <ButtonGroup class="justify-center">
          <Button size="medium" variant="outline" fullWidth @press="onDownloadManually">
            {{ getText('downloadManually') }}
          </Button>
          <Button size="medium" fullWidth variant="primary" @press="downloadAuto">
            {{ getText('retry') }}
          </Button>
        </ButtonGroup>
      </template>
    </div>
  </Dialog>
  <Dialog
    v-else-if="release"
    :open="isOpen"
    :title="getText('versionOutdatedTitle')"
    size="large"
    :isDismissable="isLastStep"
    :hideCloseButton="!isLastStep"
    :isKeyboardDismissDisabled="!isLastStep"
    @update:open="onOpenChange"
  >
    <Stepper :state="stepperState">
      <StepContent :index="0">
        <div class="flex flex-col">
          <Text class="text-center text-sm" balance>{{ getText('versionOutdatedPrompt') }}</Text>
          <div class="mb-4 mt-3 flex flex-col items-center">
            <TextGroup>
              <Text variant="h1">
                {{ getText('latestVersion', release.tagName, release.publishedAt) }}
              </Text>
              <Button
                variant="link"
                :href="release.htmlUrl"
                target="_blank"
                icon="open"
                iconPosition="end"
              >
                {{ getText('changeLog') }}
              </Button>
              <Text variant="body-sm">
                {{ getText('yourVersion') }}
                <Text weight="bold" variant="body">{{ currentVersion }}</Text>
              </Text>
            </TextGroup>
          </div>

          <ButtonGroup class="justify-center">
            <Button
              size="medium"
              variant="outline"
              fullWidth
              icon="time"
              iconPosition="end"
              @press="remindLater"
            >
              {{ getText('remindMeLater') }}
            </Button>
            <Button
              size="medium"
              fullWidth
              variant="primary"
              icon="data_download"
              iconPosition="end"
              @press="onDownload"
            >
              {{ getText('download') }}
            </Button>
          </ButtonGroup>
        </div>
      </StepContent>

      <StepContent :index="1">
        <div class="flex flex-col items-center text-center">
          <Text balance variant="body">{{ getText('downloadingAppMessage') }}</Text>
          <DialogClose variant="primary" class="mt-4 min-w-48">{{ getText('close') }}</DialogClose>
        </div>
      </StepContent>
    </Stepper>
  </Dialog>
</template>
