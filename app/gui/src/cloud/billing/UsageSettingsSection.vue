<script setup lang="ts">
/**
 * @file The Usage settings tab: for a month (the current one at first), each user's and project's
 * scheduled executions, with their count and their total and average uptime.
 */
import BasicInput from '$/components/Inputs/BasicInput.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useQuery } from '@tanstack/vue-query'
import type { ExecutionUsageSummary } from 'enso-common/src/services/Backend'
import { computed, ref } from 'vue'
import { formatUptime } from './executionUsage'
import { listExecutionsSummaryQueryOptions } from './queries'

const HEADER_CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding text-left text-sm font-semibold last:border-r-0'
const CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding px-name-column-x first:rounded-l-full last:rounded-r-full last:border-r-0'

const HEADERS = [
  { class: 'w-60', textId: 'executionSummaryUserColumn' },
  { class: 'w-60', textId: 'executionSummaryProjectColumn' },
  { class: 'w-36', textId: 'executionSummaryCountOfExecutionsColumn' },
  { class: 'w-36', textId: 'executionSummaryTotalUptimeColumn' },
  { class: 'w-36', textId: 'executionSummaryAverageUptimeColumn' },
] as const

/** The current month, as a `month` input's value (`YYYY-MM`). */
function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const { getText } = useText()
const { remoteBackend } = useBackends()

const month = ref(currentMonthValue())
const summaryQuery = useQuery(
  computed(() => listExecutionsSummaryQueryOptions(remoteBackend, month.value)),
)
const data = computed(() => summaryQuery.data.value)
const isLoading = computed(() => summaryQuery.isLoading.value)

const unknownUserPlaceholder = computed(() => getText('executionSummaryUnknownUser'))
const unknownProjectPlaceholder = computed(() => getText('executionSummaryUnknownProject'))

/** A cleared input keeps the month it had. */
function onMonthChange(nextMonth: string | number | null | undefined) {
  if (nextMonth != null && nextMonth !== '') month.value = String(nextMonth)
}

function projectName(summary: ExecutionUsageSummary) {
  const projectId = String(summary.project.projectId)
  return summary.project.name ?? (projectId || unknownProjectPlaceholder.value)
}

/** A unique key for a row. */
function rowKey(summary: ExecutionUsageSummary) {
  return `${summary.project.projectId}-${summary.user.email ?? summary.user.name ?? 'unknown'}`
}
</script>

<template>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <Text class="whitespace-nowrap">{{ getText('executionSummaryMonthLabel') }}</Text>
    <div class="w-40">
      <BasicInput
        :aria-label="getText('executionSummaryMonthLabel')"
        type="month"
        :modelValue="month"
        @update:modelValue="onMonthChange"
      />
    </div>
  </div>
  <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="top-8">
    <table class="table-fixed self-start rounded-rows">
      <thead>
        <tr class="sticky top-0 z-1 h-9 bg-dashboard">
          <td
            v-for="header in HEADERS"
            :key="header.textId"
            :class="twMerge(HEADER_CELL_CLASS, header.class)"
          >
            <Text weight="bold">{{ getText(header.textId) }}</Text>
          </td>
        </tr>
      </thead>
      <tbody class="select-text">
        <tr v-if="isLoading" class="h-12">
          <td :colspan="5" class="rounded-full bg-transparent px-name-column-x py-3">
            <div class="flex items-center justify-center gap-2">
              <StatelessSpinner :size="24" phase="loading-medium" />
              <Text>{{ getText('executionSummaryLoading') }}</Text>
            </div>
          </td>
        </tr>
        <tr v-if="!isLoading && (!data || data.length === 0)" class="h-12">
          <td :colspan="5" class="rounded-full bg-transparent px-name-column-x py-3 text-center">
            <Text>{{ getText('executionSummaryEmpty') }}</Text>
          </td>
        </tr>
        <tr v-for="summary in data ?? []" :key="rowKey(summary)" class="h-9 rounded-rows-child">
          <td :class="CELL_CLASS">
            <div class="max-w-60 truncate">
              <VisualTooltip :tooltip="summary.user.email ?? unknownUserPlaceholder">
                {{ summary.user.name ?? summary.user.email ?? unknownUserPlaceholder }}
              </VisualTooltip>
            </div>
          </td>
          <td :class="CELL_CLASS">
            <div class="max-w-60 truncate">{{ projectName(summary) }}</div>
          </td>
          <td :class="CELL_CLASS">{{ summary.totalSessions.toLocaleString() }}</td>
          <td :class="CELL_CLASS">{{ formatUptime(summary.totalUptimeSeconds) }}</td>
          <td :class="CELL_CLASS">{{ formatUptime(summary.averageUptimeSeconds) }}</td>
        </tr>
      </tbody>
    </table>
  </Scroller>
</template>
