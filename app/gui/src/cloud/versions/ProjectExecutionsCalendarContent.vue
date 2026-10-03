<script setup lang="ts">
/**
 * @file The Schedule tab's calendar for one project: a month grid counting each day's scheduled
 * executions, a button scheduling a new one, and the executions of the chosen day (those that
 * started a session first). The Vue port of the React `ProjectExecutionsCalendarInternal`.
 *
 * The calendar is Reka's `Calendar`, giving what react-aria's did: a grid of day buttons navigated
 * with the arrow keys (moving to the next or previous month at its edges), Enter or Space choosing
 * a day, and previous and next month buttons. Days outside the month are disabled; the day header
 * row is empty, as React's was (its header cells were given no content).
 *
 * While a month's executions load, a loader replaces the whole tab and the calendar keeps its state,
 * as React's suspended query did.
 */
import Button from '$/components/Button/Button.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import { FORM_STYLES } from '$/components/Form/variants'
import Loader from '$/components/Spinner/Loader.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import {
  CalendarDate,
  DateFormatter,
  isSameDay,
  isSameMonth,
  now,
  startOfMonth,
  toCalendarDate,
  today,
  toZoned,
  type DateValue,
  type ZonedDateTime,
} from '@internationalized/date'
import { useQuery } from '@tanstack/vue-query'
import type {
  Backend,
  ProjectAsset,
  ProjectExecution as BackendProjectExecution,
} from 'enso-common/src/services/Backend'
import { getProjectExecutionRepetitionsForDateRange } from 'enso-common/src/services/Backend/projectExecution'
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
} from 'reka-ui'
import { computed, shallowRef } from 'vue'
import NewProjectExecutionForm from './NewProjectExecutionForm.vue'
import ProjectExecution from './ProjectExecution.vue'
import { projectExecutionsQueryOptions, usePreferredTimeZone } from './schedule'

const { backend, item } = defineProps<{ backend: Backend; item: ProjectAsset }>()

/**
 * React's `PROJECT_EXECUTIONS_CALENDAR_STYLES`, with react-aria's `outside-visible-range:`,
 * `disabled:` and `selected:` spelled for Reka's cells. React showed the hover only on enabled
 * days (react-aria's `data-hovered`).
 */
const PROJECT_EXECUTIONS_CALENDAR_STYLES = tv({
  base: '',
  slots: {
    calendarContainer: 'w-full',
    calendarHeader: 'flex items-center mb-2',
    calendarHeading: 'text-base grow text-center',
    calendarGrid: 'w-full table-fixed',
    calendarGridHeader: 'flex',
    calendarGridCell:
      'text-center px-1 rounded border border-transparent hover:bg-primary/10 data-[disabled]:hover:bg-transparent data-[outside-view]:text-primary/30 data-[disabled]:text-primary/30 data-[selected]:border-primary/40 h-16 overflow-clip',
  },
})
const styles = PROJECT_EXECUTIONS_CALENDAR_STYLES({})
/** The maximum duration, in milliseconds, between two dates to be considered the same project execution. */
const EXECUTION_TIME_DIFFERENCE_THRESHOLD_MS = 90_000

const text = useText()
const { getText } = text
const timeZone = usePreferredTimeZone()

const focusedMonth = shallowRef<DateValue>(startOfMonth(today(timeZone.value)))
const todayDate = computed(() => today(timeZone.value))
const selectedDate = shallowRef<CalendarDate>(todayDate.value)
const monthFormatter = computed(
  () =>
    new DateFormatter(text.locale, { month: 'long', year: 'numeric', timeZone: timeZone.value }),
)
const dayFormatter = computed(
  () =>
    new DateFormatter(text.locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timeZone.value,
    }),
)
/** The shown month, as the calendar's name: "January 2045". */
const monthLabel = computed(() =>
  monthFormatter.value.format(focusedMonth.value.toDate(timeZone.value)),
)
/** A day's name, as react-aria gave it: "Today, Monday, January 23, 2045 selected". */
function dayLabel(date: DateValue) {
  const label = dayFormatter.value.format(date.toDate(timeZone.value))
  const isSelected = date.compare(selectedDate.value) === 0
  if (isSameDay(date, todayDate.value)) {
    return isSelected ? `Today, ${label} selected` : `Today, ${label}`
  }
  return isSelected ? `${label} selected` : label
}
/**
 * Days of other months are disabled, as in react-aria. (Reka's `disableDaysOutsideCurrentView`
 * would also mark every cell `aria-disabled`.) Reka reads this when the calendar is created; it
 * follows the shown month itself.
 */
function isOutsideMonth(date: DateValue) {
  return !isSameMonth(date, focusedMonth.value)
}

/** "Now", until another day is chosen: the default first occurrence of a new execution. */
const defaultStartDateTime = shallowRef<ZonedDateTime | undefined>(now(timeZone.value))

function selectDate(date: { year: number; month: number; day: number } | undefined) {
  if (date == null) return
  selectedDate.value = new CalendarDate(date.year, date.month, date.day)
  if (
    defaultStartDateTime.value &&
    toCalendarDate(defaultStartDateTime.value).compare(selectedDate.value) !== 0
  ) {
    // Unset the override away from *now* if the date part is changed.
    defaultStartDateTime.value = undefined
  }
}

const projectExecutionsQuery = useQuery(
  computed(() =>
    projectExecutionsQueryOptions(
      backend,
      item.id,
      item.title,
      focusedMonth.value.year,
      focusedMonth.value.month,
    ),
  ),
)
const projectExecutions = computed(() => projectExecutionsQuery.data.value ?? [])

const projectExecutionsByDate = computed(() => {
  const start = startOfMonth(focusedMonth.value)
  const startDate = toZoned(start, timeZone.value)
  const end = startOfMonth(focusedMonth.value.add({ months: 1 }))
  const endDate = toZoned(end, timeZone.value)
  const byDate: Record<
    string,
    { readonly date: ZonedDateTime; readonly projectExecution: BackendProjectExecution }[]
  > = {}
  for (const projectExecution of projectExecutions.value) {
    for (const date of getProjectExecutionRepetitionsForDateRange(
      projectExecution,
      startDate,
      endDate,
    )) {
      const dateString = toCalendarDate(date).toString()
      ;(byDate[dateString] ??= []).push({ date, projectExecution })
    }
  }
  for (const key in byDate) {
    byDate[key]?.sort((a, b) => Number(a.date) - Number(b.date))
  }
  return byDate
})

/** The executions on the chosen day, those that started a session first. */
const projectExecutionsForDay = computed(() => {
  const selected = selectedDate.value
  const executions = projectExecutions.value
    .flatMap((projectExecution) =>
      getProjectExecutionRepetitionsForDateRange(
        projectExecution,
        toZoned(selected, projectExecution.timeZone),
        toZoned(selected.add({ days: 1 }), projectExecution.timeZone),
      ).map((date) => {
        const session = projectExecution.projectSessions?.find(
          (otherSession) =>
            Math.abs(Number(new Date(otherSession.createdAt)) - Number(date.toDate())) <
            EXECUTION_TIME_DIFFERENCE_THRESHOLD_MS,
        )
        return { date, projectExecution, session }
      }),
    )
    .sort((a, b) => Number(a.date.toDate()) - Number(b.date.toDate()))
  return [
    ...executions.filter(({ session }) => session !== undefined),
    ...executions.filter(({ session }) => session === undefined),
  ]
})

/** The new execution's default first occurrence: the chosen day (or now), at the current time. */
function newExecutionDefaultDate() {
  const current = now(timeZone.value)
  return toZoned(defaultStartDateTime.value ?? selectedDate.value, timeZone.value).set({
    hour: current.hour,
    minute: current.minute,
  })
}
</script>

<template>
  <Loader v-if="projectExecutionsQuery.isPending.value" minHeight="h24" size="medium" />
  <!-- React's `Form` around the calendar, which only held the chosen day. -->
  <form
    v-show="!projectExecutionsQuery.isPending.value"
    :class="
      FORM_STYLES({
        className:
          'pointer-events-auto flex w-full flex-col items-center gap-2 self-start overflow-y-auto overflow-x-hidden',
      })
    "
    novalidate
    @submit.prevent
  >
    <!-- Named and structured for assistive technology as react-aria's calendar was: an
    "application" named by the month, with a hidden heading, a "grid" of day buttons named by
    their date ("Today, …", "… selected"), and a hidden "Next" button at the end. -->
    <CalendarRoot
      v-slot="{ grid }"
      v-model:placeholder="focusedMonth"
      :modelValue="selectedDate"
      preventDeselect
      :isDateDisabled="isOutsideMonth"
      role="application"
      :aria-label="monthLabel"
      :class="styles.calendarContainer()"
      @update:modelValue="selectDate"
    >
      <h2 class="sr-only">{{ monthLabel }}</h2>
      <header :class="styles.calendarHeader()">
        <CalendarPrev asChild :aria-label="getText('previous')">
          <Button variant="icon" icon="chevron_right" class="rotate-180" />
        </CalendarPrev>
        <CalendarHeading as="h2" aria-hidden="true" :class="styles.calendarHeading()" />
        <CalendarNext asChild :aria-label="getText('next')">
          <Button variant="icon" icon="chevron_right" />
        </CalendarNext>
      </header>
      <CalendarGrid
        v-for="month in grid"
        :key="month.value.toString()"
        role="grid"
        :aria-label="monthLabel"
        :class="styles.calendarGrid()"
      >
        <CalendarGridHead :class="styles.calendarGridHeader()">
          <CalendarGridRow>
            <CalendarHeadCell v-for="day in 7" :key="day" />
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow v-for="(week, w) in month.rows" :key="w">
            <CalendarCell v-for="date in week" :key="date.toString()" :date="date">
              <CalendarCellTrigger
                :day="date"
                :month="month.value"
                :aria-label="dayLabel(date)"
                :class="styles.calendarGridCell()"
              >
                <div class="flex flex-col items-center">
                  <Text
                    :weight="date.compare(todayDate) === 0 ? 'bold' : 'medium'"
                    :color="date.compare(todayDate) === 0 ? 'success' : 'inherit'"
                  >
                    {{ date.day }}
                  </Text>
                  <Button
                    v-if="projectExecutionsByDate[date.toString()]"
                    isDisabled
                    :tooltip="
                      getText(
                        'xExecutionsScheduledOnX',
                        projectExecutionsByDate[date.toString()]!.length,
                        date.toString(),
                      )
                    "
                    size="xxsmall"
                    variant="custom"
                    class="disabled:cursor-unset disabled:opacity-100"
                    icon="schedule"
                  >
                    {{ projectExecutionsByDate[date.toString()]!.length }}
                  </Button>
                </div>
              </CalendarCellTrigger>
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
      <button
        type="button"
        class="sr-only"
        tabindex="-1"
        :aria-label="getText('next')"
        @click="focusedMonth = startOfMonth(focusedMonth).add({ months: 1 })"
      />
    </CalendarRoot>
    <Dialog :title="getText('newProjectExecution')">
      <template #trigger>
        <Button variant="outline">{{ getText('newProjectExecution') }}</Button>
      </template>
      <NewProjectExecutionForm
        :backend="backend"
        :item="item"
        :defaultDate="newExecutionDefaultDate()"
      />
    </Dialog>
    <Text>{{ getText('projectSessionsOnX', selectedDate.toString()) }}</Text>
    <Text v-if="projectExecutionsForDay.length === 0" color="disabled">
      {{ getText('noProjectExecutions') }}
    </Text>
    <ProjectExecution
      v-for="{ projectExecution, date, session } in projectExecutionsForDay"
      :key="projectExecution.executionId"
      :backend="backend"
      :item="item"
      :projectExecution="projectExecution"
      :date="date"
      :session="session"
    />
  </form>
</template>
