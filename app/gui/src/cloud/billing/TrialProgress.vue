<script setup lang="ts">
/**
 * @file The user bar's trial indicator (#83): while the organization's subscription is in its
 * trial, a bar showing how much of it is used, with the time left, and its end date as a tooltip.
 * Only an organization's admin sees it; nothing is drawn otherwise.
 */
import ProgressBar from '$/components/ProgressBar/ProgressBar.vue'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import type { UserSession } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { rfc3339DurationProgress } from '$/utils/time'
import { backendQueryOptions } from '@/composables/backend'
import { useQuery } from '@tanstack/vue-query'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { computed } from 'vue'

const { user } = defineProps<{ user: UserSession['user'] }>()

const { getText } = useText()
const { remoteBackend } = useBackends()

const organizationQueryOptions = backendQueryOptions('getOrganization', [], remoteBackend)
const { data: organization } = useQuery({
  ...organizationQueryOptions,
  enabled: computed(() => user.isOrganizationAdmin),
})

const trial = computed(() => {
  const subscription = user.isOrganizationAdmin ? organization.value?.subscription : null
  const { trialStart, trialEnd } = subscription ?? {}
  if (trialEnd == null || trialStart == null || new Date(trialEnd) <= new Date()) return null
  const progress = rfc3339DurationProgress(trialStart, trialEnd)
  const text =
    progress.daysLeft > 0 ? getText('xDaysLeftInTrial', progress.daysLeft)
    : progress.hoursLeft > 0 ? getText('xHoursLeftInTrial', progress.hoursLeft)
    : getText('lessThanOneHourLeftInTrial')
  return {
    fraction: progress.fraction,
    text,
    tooltip: getText('yourSubscriptionExpiresAtX', toReadableIsoString(new Date(trialEnd))),
  }
})
</script>

<template>
  <VisualTooltip v-if="trial" class="relative px-2" :tooltip="trial.tooltip">
    <Text class="opacity-0">{{ trial.text }}</Text>
    <ProgressBar
      :progress="trial.fraction"
      variant="clipped"
      class="absolute inset-0"
      progressBarClass="bg-accent/50"
      :aria-label="getText('trialProgressLabel')"
    />
    <Text class="absolute inset-0 mx-2 cursor-help text-center">{{ trial.text }}</Text>
  </VisualTooltip>
</template>
