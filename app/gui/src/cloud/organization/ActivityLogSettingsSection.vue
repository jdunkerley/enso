<script setup lang="ts">
/**
 * @file The Activity log settings tab: the organization's audit log, filtered by date range, event
 * type and user, sortable by each column, and loaded a page at a time as it is scrolled. The Vue
 * port of the React `ActivityLogSettingsSection`.
 */
import Button from '$/components/Button/Button.vue'
import Form from '$/components/Form/Form.vue'
import { useForm } from '$/components/Form/useForm'
import Icon from '$/components/Icon/Icon.vue'
import { ICON_DISPLAY_STYLES } from '$/components/Icon/variants'
import ComboBox from '$/components/Inputs/ComboBox.vue'
import DatePicker from '$/components/Inputs/DatePicker.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import Text from '$/components/Text/Text.vue'
import UserWithPopover from '$/components/UserWithPopover/UserWithPopover.vue'
import { useBackends } from '$/providers/backends'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useText } from '$/providers/text'
import { iconIdFor, nextSortDirection, type SortInfo } from '$/utils/sorting'
import { twMerge } from '$/utils/style/tailwindMerge'
import { getLocalTimeZone, today, type DateValue } from '@internationalized/date'
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import type { AuditLogEvent, EmailAddress, User } from 'enso-common/src/services/Backend'
import { toReadableIsoString, toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import type { TextId } from 'enso-common/src/text'
import { computed, ref, watch } from 'vue'
import { z } from 'zod'
import {
  DEFAULT_EVENT_ICON,
  EVENT_TYPE_ICON,
  EVENT_TYPE_NAME_ID,
  LAMBDA_KINDS,
  normalizeLambdaKind,
  SELECTABLE_LAMBDA_KINDS,
} from './lambdaKinds'
import { listUsersQueryOptions, logEventsQueryOptions, type LogEventsFilter } from './queries'

/** Sortable columns of the activity log. */
enum ActivityLogSortableColumn {
  type = 'type',
  user = 'user',
  timestamp = 'timestamp',
}

/** A sortable column's header: its text and the labels of its sort button. */
interface SortableHeader {
  readonly field: ActivityLogSortableColumn
  readonly class: string
  readonly textId: TextId
  readonly sortId: TextId
  readonly stopSortingId: TextId
  readonly sortDescendingId: TextId
}

const SORTABLE_HEADERS: readonly SortableHeader[] = [
  {
    field: ActivityLogSortableColumn.type,
    class: 'w-60',
    textId: 'type',
    sortId: 'sortByName',
    stopSortingId: 'stopSortingByName',
    sortDescendingId: 'sortByNameDescending',
  },
  {
    field: ActivityLogSortableColumn.user,
    class: 'w-48',
    textId: 'user',
    sortId: 'sortByEmail',
    stopSortingId: 'stopSortingByEmail',
    sortDescendingId: 'sortByEmailDescending',
  },
  {
    field: ActivityLogSortableColumn.timestamp,
    class: 'w-40',
    textId: 'timestamp',
    sortId: 'sortByTimestamp',
    stopSortingId: 'stopSortingByTimestamp',
    sortDescendingId: 'sortByTimestampDescending',
  },
]

const HEADER_CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding text-left text-sm font-semibold last:border-r-0'
const CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding px-name-column-x first:rounded-l-full last:rounded-r-full last:border-r-0'

const { getText } = useText()
const { remoteBackend } = useBackends()

const sortInfo = ref<SortInfo<ActivityLogSortableColumn> | null>(null)
const usersQuery = useQuery(listUsersQueryOptions(remoteBackend, Infinity))
const users = computed(() =>
  [...(usersQuery.data.value ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
)
const allEmails = computed(() => users.value.map((user) => user.email))
const usersByEmail = computed(
  () => new Map<EmailAddress, User>(users.value.map((user) => [user.email, user])),
)

const lambdaKindsByName = computed(
  () => new Map(SELECTABLE_LAMBDA_KINDS.map((kind) => [getText(EVENT_TYPE_NAME_ID[kind]), kind])),
)
const endpointNames = computed(() =>
  [...lambdaKindsByName.value.keys()].sort((a, b) => a.localeCompare(b)),
)

const pageSize = useFeatureFlag('getLogEventsPageSize')
const form = useForm({
  schema: z.object({
    userEmail: z.custom<EmailAddress>((s) => typeof s === 'string').optional(),
    type: z.string().optional(),
    startDate: z.custom<DateValue>().optional(),
    endDate: z.custom<DateValue>().optional(),
  }),
})
const maxDate = today(getLocalTimeZone())

/** A picked day, as the start of that day in the user's time zone, as React's `toDate()` gave. */
function dayToRfc3339(date: DateValue | null | undefined) {
  return date == null ? undefined : toRfc3339(date.toDate(getLocalTimeZone()))
}

const lambdaKind = computed(() => {
  const type = form.watch('type') as string | undefined
  return type != null ? lambdaKindsByName.value.get(type) : null
})
const filter = computed((): LogEventsFilter => ({
  userEmail: form.watch('userEmail') as EmailAddress | undefined,
  lambdaKind: lambdaKind.value,
  startDate: dayToRfc3339(form.watch('startDate') as DateValue | undefined),
  endDate: dayToRfc3339(form.watch('endDate') as DateValue | undefined),
  pageSize: pageSize.value,
}))
const logsPages = useInfiniteQuery(logEventsQueryOptions(remoteBackend, () => filter.value))
const logs = computed(() => logsPages.data.value?.pages.flat())
const isFetching = computed(() => logsPages.isLoading.value || logsPages.isFetchingNextPage.value)

const scroller = ref<InstanceType<typeof Scroller>>()
const scrollerContent = computed(() => scroller.value?.content)

/** Load the next page once the list is scrolled to its end, or when it does not fill the view. */
function fetchNextPageAtEnd() {
  const element = scrollerContent.value
  if (element == null) return
  if (element.scrollTop + element.clientHeight >= element.scrollHeight) {
    void logsPages.fetchNextPage()
  }
}

watch(() => logsPages.data.value?.pages, fetchNextPageAtEnd, { flush: 'post' })
useEventListener(scrollerContent, 'scroll', () => {
  if (!isFetching.value) fetchNextPageAtEnd()
})

const sortedLogs = computed(() => {
  const filteredLogs = logs.value?.filter((log) => {
    if (log.lambdaKind == null) return false
    const kind = normalizeLambdaKind(log.lambdaKind)
    return lambdaKind.value == null || !kind.valid || kind.kind === lambdaKind.value
  })
  const sort = sortInfo.value
  if (sort == null || filteredLogs == null) return filteredLogs
  const multiplier = sort.direction === 'ascending' ? 1 : -1
  let compare: (a: AuditLogEvent, b: AuditLogEvent) => number
  switch (sort.field) {
    case ActivityLogSortableColumn.type: {
      compare = (a, b) => {
        if (a.lambdaKind == null) return b.lambdaKind == null ? 0 : multiplier
        if (b.lambdaKind == null) return -multiplier
        const aKind = normalizeLambdaKind(a.lambdaKind)
        const aIndex = aKind.valid ? LAMBDA_KINDS.indexOf(aKind.kind) : LAMBDA_KINDS.length
        const bKind = normalizeLambdaKind(b.lambdaKind)
        const bIndex = bKind.valid ? LAMBDA_KINDS.indexOf(bKind.kind) : LAMBDA_KINDS.length
        return multiplier * (aIndex - bIndex)
      }
      break
    }
    case ActivityLogSortableColumn.user: {
      compare = (a, b) => {
        const aName = usersByEmail.value.get(a.userEmail)?.name ?? a.userEmail
        const bName = usersByEmail.value.get(b.userEmail)?.name ?? b.userEmail
        return multiplier * aName.localeCompare(bName)
      }
      break
    }
    case ActivityLogSortableColumn.timestamp: {
      compare = (a, b) => {
        const aTime = a.timestamp == null ? 0 : Number(new Date(a.timestamp))
        const bTime = b.timestamp == null ? 0 : Number(new Date(b.timestamp))
        // As in React, which applied the direction to the first operand only.
        return multiplier * aTime - bTime
      }
      break
    }
  }
  return [...filteredLogs].sort(compare)
})

function sortLabel(header: SortableHeader) {
  const sort = sortInfo.value
  return (
    sort?.field !== header.field ? getText(header.sortId)
    : sort.direction === 'descending' ? getText(header.stopSortingId)
    : getText(header.sortDescendingId)
  )
}

function toggleSort(field: ActivityLogSortableColumn) {
  const sort = sortInfo.value
  const nextDirection = sort?.field === field ? nextSortDirection(sort.direction) : 'ascending'
  sortInfo.value = nextDirection == null ? null : { field, direction: nextDirection }
}

const iconDisplayStyles = ICON_DISPLAY_STYLES({ align: 'left' })

/** The text a user option filters by: its name and address. */
function userText(email: EmailAddress) {
  const name = usersByEmail.value.get(email)?.name
  return name == null ? email : `${name} (${email})`
}

/** A log event's type, as shown in its row. */
function eventTypeText(log: AuditLogEvent) {
  const kind = log.lambdaKind == null ? null : normalizeLambdaKind(log.lambdaKind)
  return kind?.valid === true ?
      getText(EVENT_TYPE_NAME_ID[kind.kind])
    : (kind?.invalidKind ?? '(unknown)')
}

function eventTypeIcon(log: AuditLogEvent) {
  const kind = log.lambdaKind == null ? null : normalizeLambdaKind(log.lambdaKind)
  return kind?.valid === true ? EVENT_TYPE_ICON[kind.kind] : DEFAULT_EVENT_ICON
}
</script>

<template>
  <Form :form="form" class="flex flex-row flex-wrap gap-3">
    <div class="flex items-center gap-2">
      <Text class="whitespace-nowrap">{{ getText('startDate') }}</Text>
      <DatePicker name="startDate" :maxValue="maxDate" class="w-36" />
    </div>
    <div class="flex items-center gap-2">
      <Text class="whitespace-nowrap">{{ getText('endDate') }}</Text>
      <DatePicker name="endDate" :maxValue="maxDate" class="w-36" />
    </div>
    <div class="flex items-center gap-2">
      <Text class="whitespace-nowrap">{{ getText('type') }}</Text>
      <ComboBox name="type" :ariaLabel="getText('type')" :items="endpointNames" class="w-60">
        <template #default="{ item: otherType }">
          <div v-if="lambdaKindsByName.get(otherType) != null" class="flex w-full">
            <div :class="iconDisplayStyles.base()">
              <Icon
                :class="iconDisplayStyles.icon()"
                size="medium"
                :icon="EVENT_TYPE_ICON[lambdaKindsByName.get(otherType)!]"
              />
              <div :class="iconDisplayStyles.container()">
                <Text :class="iconDisplayStyles.text()" truncate="1" :tooltip="otherType">
                  {{ otherType }}
                </Text>
              </div>
            </div>
          </div>
          <template v-else>{{ otherType }}</template>
        </template>
      </ComboBox>
    </div>
    <div class="flex items-center gap-2">
      <Text class="whitespace-nowrap">{{ getText('user') }}</Text>
      <ComboBox
        name="userEmail"
        :ariaLabel="getText('user')"
        :items="allEmails"
        :toTextValue="userText"
        class="w-96"
      >
        <template #default="{ item: email }">
          <UserWithPopover
            v-if="usersByEmail.get(email) != null"
            :user="{ ...usersByEmail.get(email)!, name: userText(email) }"
            class="pointer-events-none"
          />
        </template>
      </ComboBox>
    </div>
  </Form>
  <Scroller
    ref="scroller"
    scrollbar
    orientation="vertical"
    class="min-h-0 flex-1"
    shadowStartClass="top-8"
  >
    <table class="table-fixed self-start rounded-rows">
      <thead>
        <tr class="sticky top-0 z-1 h-9 bg-dashboard">
          <td :class="twMerge(HEADER_CELL_CLASS, 'w-8')" />
          <td
            v-for="header in SORTABLE_HEADERS"
            :key="header.field"
            :class="twMerge(HEADER_CELL_CLASS, header.class)"
          >
            <Button
              size="custom"
              variant="custom"
              :aria-label="sortLabel(header)"
              class="group flex h-9 w-full items-center justify-start gap-2 border-0 px-name-column-x"
              @press="toggleSort(header.field)"
            >
              <Text weight="bold">{{ getText(header.textId) }}</Text>
              <template #addonEnd>
                <Icon
                  :icon="iconIdFor(sortInfo?.direction, sortInfo?.field === header.field)"
                  :class="
                    twMerge(
                      'ml-1 transition-all duration-arrow',
                      sortInfo?.field !== header.field && 'opacity-0 group-hover:opacity-50',
                    )
                  "
                />
              </template>
            </Button>
          </td>
        </tr>
      </thead>
      <tbody class="select-text">
        <tr v-for="(log, i) in sortedLogs ?? []" :key="i" class="h-9">
          <td :class="CELL_CLASS">
            <div class="flex items-center"><Icon :icon="eventTypeIcon(log)" /></div>
          </td>
          <td :class="CELL_CLASS">{{ eventTypeText(log) }}</td>
          <td :class="CELL_CLASS">
            <div v-if="usersByEmail.get(log.userEmail) != null" class="flex w-48">
              <UserWithPopover :user="usersByEmail.get(log.userEmail)!" />
            </div>
            <template v-else>{{ log.userEmail }}</template>
          </td>
          <td :class="CELL_CLASS">
            {{ log.timestamp ? toReadableIsoString(new Date(log.timestamp)) : '' }}
          </td>
        </tr>
        <tr v-if="isFetching" class="h-9">
          <td :colspan="4" class="rounded-full bg-transparent">
            <div class="flex justify-center">
              <StatelessSpinner :size="32" phase="loading-medium" />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </Scroller>
</template>
