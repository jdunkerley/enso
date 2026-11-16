<script setup lang="ts">
/**
 * @file A month calendar: it opens on the shown day's month, marks the selected day and emits every day picked.
 *
 * The calendar is Reka's `Calendar` (as the dashboard's `DatePicker` uses for its popover): arrows
 * move between days, Enter picks one, PageUp and PageDown change the month.
 */
import { CalendarDate, type DateValue } from '@internationalized/date'
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
} from 'reka-ui'
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { YearMonthDay } from './dateExpression'

const props = defineProps<{
  /** The day marked as chosen, if any. */
  selected: YearMonthDay | undefined
  /** The day whose month the calendar opens on. */
  shown: YearMonthDay
}>()
const emit = defineEmits<{
  /** Every day clicked or chosen with Enter, the selected one too. */
  pick: [day: YearMonthDay]
}>()

const root = useTemplateRef('root')
const toCalendarDate = ({ year, month, day }: YearMonthDay) => new CalendarDate(year, month, day)

const selectedDate = computed(() => (props.selected ? toCalendarDate(props.selected) : null))
const placeholder = shallowRef<DateValue>(toCalendarDate(props.shown))
/** The dates `Date.new` takes and the widget recognises (`isValidDate`): years 100 to 9999. */
const minValue = new CalendarDate(100, 1, 1)
const maxValue = new CalendarDate(9999, 12, 31)

function pick(value: unknown) {
  if (!(value instanceof CalendarDate)) return
  emit('pick', { year: value.year, month: value.month, day: value.day })
}

defineExpose({
  /** Put the keyboard on the chosen day, else today, else the first focusable day. */
  focusDay() {
    const days = (root.value?.$el as HTMLElement | undefined)?.querySelectorAll<HTMLElement>(
      '[data-reka-calendar-cell-trigger]',
    )
    const inMonth = Array.from(days ?? []).filter((d) => !d.hasAttribute('data-outside-view'))
    const target =
      inMonth.find((d) => d.hasAttribute('data-selected')) ??
      inMonth.find((d) => d.hasAttribute('data-today')) ??
      inMonth.find((d) => d.getAttribute('tabindex') === '0') ??
      inMonth[0]
    target?.focus()
  },
})
</script>

<template>
  <CalendarRoot
    ref="root"
    v-slot="{ weekDays, grid }"
    v-model:placeholder="placeholder"
    class="calendar"
    :modelValue="selectedDate"
    :minValue="minValue"
    :maxValue="maxValue"
    :preventDeselect="true"
    :fixedWeeks="true"
    @update:modelValue="pick"
  >
    <CalendarHeader class="calendarHeader">
      <CalendarPrev class="navButton" aria-label="Previous month">&lsaquo;</CalendarPrev>
      <CalendarHeading class="heading" />
      <CalendarNext class="navButton" aria-label="Next month">&rsaquo;</CalendarNext>
    </CalendarHeader>
    <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="grid">
      <CalendarGridHead>
        <CalendarGridRow class="row">
          <CalendarHeadCell v-for="(day, i) in weekDays" :key="i" class="headCell">
            {{ day }}
          </CalendarHeadCell>
        </CalendarGridRow>
      </CalendarGridHead>
      <CalendarGridBody>
        <CalendarGridRow v-for="(week, w) in month.rows" :key="w" class="row">
          <CalendarCell v-for="date in week" :key="date.toString()" :date="date">
            <CalendarCellTrigger :day="date" :month="month.value" class="day" />
          </CalendarCell>
        </CalendarGridRow>
      </CalendarGridBody>
    </CalendarGrid>
  </CalendarRoot>
</template>

<style scoped>
.calendarHeader {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.heading {
  flex-grow: 1;
  text-align: center;
}

.navButton {
  width: var(--item-height);
  height: var(--item-height);
  border-radius: 50%;

  &:hover {
    background-color: var(--dropdown-item-hover-bg);
  }
}

.grid {
  width: 100%;
  border-collapse: collapse;
}

.row {
  display: flex;
  justify-content: space-between;
}

.headCell {
  width: var(--item-height);
  text-align: center;
  opacity: 0.5;
}

.day {
  display: block;
  width: var(--item-height);
  height: var(--item-height);
  line-height: var(--item-height);
  text-align: center;
  border-radius: 50%;
  border: 1px solid transparent;

  &:hover,
  &:focus-visible {
    background-color: var(--dropdown-item-hover-bg);
  }

  &[data-outside-view] {
    opacity: 0.35;
  }

  &[data-today] {
    font-weight: bold;
    text-decoration: underline;
  }

  &[data-selected] {
    background-color: var(--dropdown-item-selected-bg);
    border-color: currentColor;
  }
}
</style>
