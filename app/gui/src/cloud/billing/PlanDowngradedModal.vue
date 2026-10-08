<script setup lang="ts">
/**
 * @file The dialog warning that a downgraded plan's assets will be deleted.
 *
 * `AppContainerLayout.vue` mounts it for a free plan whose subscription is paused (through the
 * modals `registerCloud` contributes), with the deletion deadline. It opens while the deadline is
 * ahead and enough time has passed since the user last acknowledged it: the time left to the
 * deadline, but at least an hour and at most five days, so it shows more often as the deadline
 * nears. The time is re-read every minute. "Confirm" records the acknowledgement; it has no cancel
 * button.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { DAY_MS, HOUR_MS, HOURS_PER_DAY, MINUTE_MS } from '$/utils/time'
import { computed, onScopeDispose, ref } from 'vue'
import { useDowngradeModalState } from './downgradeModalState'

/** Minimum amount of time that must pass before the modal is shown again. */
const MIN_SHOW_INTERVAL = HOUR_MS
/** Maximum amount of time that must pass before the modal is shown again. */
const MAX_SHOW_INTERVAL = DAY_MS * 5

const { deletionDeadlineTimestamp } = defineProps<{ deletionDeadlineTimestamp: number }>()

const { getText } = useText()
const { lastShownTimestamp, markAsShown } = useDowngradeModalState()

// Progress time reference every minute, so we can show the modal as time goes on.
const referenceNowTime = ref(Date.now())
const interval = window.setInterval(() => (referenceNowTime.value = Date.now()), MINUTE_MS)
onScopeDispose(() => window.clearInterval(interval))

const msToDeadline = computed(() => deletionDeadlineTimestamp - referenceNowTime.value)
const daysLeft = computed(() => Math.floor(msToDeadline.value / DAY_MS))
const hoursLeft = computed(() => Math.floor(msToDeadline.value / HOUR_MS) % HOURS_PER_DAY)

const isOpen = computed(() => {
  // Show alert again if the time elapsed since last showing is greater than the time left to
  // delete. That way the alerts become more frequent as the deadline approaches. Limited by set
  // min/max range.
  const showInterval = Math.min(MAX_SHOW_INTERVAL, Math.max(msToDeadline.value, MIN_SHOW_INTERVAL))
  const timeSinceLastShow = referenceNowTime.value - lastShownTimestamp.value
  const modalDueToShow = timeSinceLastShow > showInterval
  return msToDeadline.value > 0 && modalDueToShow
})
</script>

<template>
  <AlertDialog
    :open="isOpen"
    :title="getText('downgradedTitle')"
    :cancel="null"
    :canSubmitOffline="false"
    :onConfirm="markAsShown"
  >
    <Text class="relative">{{ getText('downgradedExplanation') }}</Text>
    <Alert variant="outline" icon="warning">
      {{ getText('downgradedWarning', daysLeft, hoursLeft) }}
    </Alert>
  </AlertDialog>
</template>
