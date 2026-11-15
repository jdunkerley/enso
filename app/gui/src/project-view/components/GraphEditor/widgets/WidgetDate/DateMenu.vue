<script setup lang="ts">
/**
 * @file The date widget's menu: Today, Yesterday and Tomorrow, a divider, then a month calendar. It
 * knows nothing of the graph: it takes the chip's current choice and emits the one that is made.
 * Choosing writes nothing here; `WidgetDate.vue` does that.
 *
 * The calendar is Reka's `Calendar` (as the dashboard's `DatePicker` uses for its popover): arrows
 * move between days, Enter chooses one, PageUp and PageDown change the month. Escape asks to close.
 */
import ChipMenuFrame from '@/components/GraphEditor/widgets/WidgetChip/ChipMenuFrame.vue'
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
import { computed, nextTick, onMounted, shallowRef, useTemplateRef } from 'vue'
import {
  RELATIVE_CHOICES,
  dateLabel,
  localToday,
  resolveChoice,
  type DateChoice,
  type YearMonthDay,
} from './dateExpression'

const props = defineProps<{
  /** What the chip holds now; `undefined` for an unset argument. */
  choice: DateChoice | undefined
  /** Today's date; the browser's by default. A test sets it. */
  today?: YearMonthDay | undefined
}>()
const emit = defineEmits<{
  choose: [choice: DateChoice]
  close: []
}>()

const root = useTemplateRef('root')
const today = computed(() => props.today ?? localToday())
const toCalendarDate = ({ year, month, day }: YearMonthDay) => new CalendarDate(year, month, day)

/** The day the calendar opens on, and marks as chosen when the value is a specific date. */
const shownDay = computed(() => resolveChoice(props.choice ?? { kind: 'today' }, today.value))
const selected = computed(() =>
  props.choice?.kind === 'date' ? toCalendarDate(props.choice) : null,
)
const placeholder = shallowRef<DateValue>(toCalendarDate(shownDay.value))

function chooseDay(value: unknown) {
  if (value instanceof CalendarDate)
    emit('choose', { kind: 'date', year: value.year, month: value.month, day: value.day })
}

onMounted(() =>
  nextTick(() => {
    // Put the keyboard on the calendar: the chosen day, else today, else the day it opened on.
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
  }),
)
</script>

<template>
  <ChipMenuFrame ref="root" class="DateMenu" ariaLabel="Pick a date" @close="emit('close')">
    <ul class="relative">
      <li v-for="relative in RELATIVE_CHOICES" :key="relative.kind">
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === relative.kind }"
          :data-choice="relative.kind"
          @click="emit('choose', relative)"
        >
          {{ dateLabel(relative) }}
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <CalendarRoot
      v-slot="{ weekDays, grid }"
      v-model:placeholder="placeholder"
      class="calendar"
      :modelValue="selected"
      :preventDeselect="true"
      :fixedWeeks="true"
      @update:modelValue="chooseDay"
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
  </ChipMenuFrame>
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
