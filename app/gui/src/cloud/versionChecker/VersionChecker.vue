<script setup lang="ts">
/**
 * @file The "new version available" dialog (#83): the Vue counterpart of the React
 * `VersionChecker`, which `App.vue` mounts while `useVersionCheckerEnabled` holds.
 *
 * It fetches the latest release once a day (every ten minutes after a failure). When it is newer
 * than this build (and this build is neither a development nor a nightly one), it asks the user to
 * download it, or to be reminded later, which hides it until the next check. After "Download" it
 * thanks the user and can be closed. The devtools can force it open in development.
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
import { download } from '$/utils/download'
import { getDownloadUrl, getLatestRelease } from '$/utils/github'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watchEffect } from 'vue'

const STALE_TIME = 24 * 60 * 60 * 1000 // 1 day
const STALE_TIME_ERROR = 10 * 60 * 1000 // 10 minutes
const QUERY_KEY = ['latestRelease']

/** The latest release, as cached: `isPostponed` once the user asked to be reminded later. */
type CachedRelease = Awaited<ReturnType<typeof getLatestRelease>> & {
  readonly isPostponed: boolean
}

/**
 * The version number of a version string, or `null` if it is not one. (Only the first dot is
 * removed, so `2025.1.1` is `20251.1`, as it always has been.)
 */
function getVersionNumber(version: string) {
  const versionNumber = Number(version.replace('.', ''))
  return isNaN(versionNumber) ? null : versionNumber
}

const currentVersion: string = $config.VERSION ?? 'unknown-dev'
const currentVersionIsDev = currentVersion.endsWith('-dev')
const currentVersionIsNightly = currentVersion.includes('-nightly')
const currentVersionNumber = getVersionNumber(currentVersion)

const text = useText()
const { getText } = text
const toasts = useToasts()
const devtools = useDevtoolsStore()
const queryClient = useQueryClient()

const shouldOverride = computed(() => devtools.showVersionChecker ?? false)

const metadataQuery = useQuery({
  queryKey: QUERY_KEY,
  queryFn: async (): Promise<CachedRelease> => ({
    ...(await getLatestRelease()),
    isPostponed: false,
  }),
  select: (data: CachedRelease) => {
    const versionNumber = getVersionNumber(data.tag_name)
    const publishedAt = new Date(data.published_at).toLocaleString(text.locale, {
      dateStyle: 'long',
    })
    return {
      versionNumber: versionNumber ?? currentVersionNumber,
      publishedAt,
      tagName: versionNumber == null ? currentVersion : data.tag_name,
      htmlUrl: data.html_url,
      isPostponed: data.isPostponed,
    }
  },
  meta: { persist: false },
  staleTime: (query) => (query.state.error ? STALE_TIME_ERROR : STALE_TIME),
})

const { stepperState, isLastStep, resetStepper, nextStep } = useStepperState({ steps: 2 })

const isOpen = ref(false)

/** The release to tell the user about, or `null` while the dialog should not show. */
const release = computed(() => {
  const data = metadataQuery.data.value
  if (!metadataQuery.isSuccess.value || data == null || data.isPostponed) return null
  const shouldBeShown =
    shouldOverride.value ||
    (data.versionNumber != null &&
      currentVersionNumber != null &&
      !currentVersionIsDev &&
      !currentVersionIsNightly &&
      data.versionNumber > currentVersionNumber)
  return shouldBeShown ? data : null
})

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
    v-if="release"
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
