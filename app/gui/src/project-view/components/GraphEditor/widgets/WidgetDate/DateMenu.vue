<script setup lang="ts">
/**
 * @file The date widget's menu: `Date.today`, `Date.yesterday` and `Date.tomorrow`, a divider, then a month calendar. It
 * knows nothing of the graph: it takes the value's current choice and emits the one that is made.
 * Choosing writes nothing here; `WidgetDate.vue` does that.
 *
 * Escape asks to close; the calendar is `DateCalendar.vue`.
 */
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { computed, nextTick, onMounted, useTemplateRef } from 'vue'
import DateCalendar from './DateCalendar.vue'
import {
  RELATIVE_CHOICES,
  dateExpressionCode,
  localToday,
  resolveChoice,
  type DateChoice,
  type YearMonthDay,
} from './dateExpression'

const props = defineProps<{
  /** What the value holds now; `undefined` for an unset argument. */
  choice: DateChoice | undefined
  /** Today's date; the browser's by default. A test sets it. */
  today?: YearMonthDay | undefined
}>()
const emit = defineEmits<{
  choose: [choice: DateChoice]
  close: []
}>()

const calendar = useTemplateRef<InstanceType<typeof DateCalendar>>('calendar')
const today = computed(() => props.today ?? localToday())

/** The day the calendar opens on. */
const shownDay = computed(() => resolveChoice(props.choice ?? { kind: 'today' }, today.value))
/** The day marked as chosen when the value is a specific date. */
const selectedDay = computed(() => (props.choice?.kind === 'date' ? props.choice : undefined))

/** Choosing the day that is already chosen changes nothing, so it only closes the menu. */
function chooseDay(day: YearMonthDay) {
  const chosen = selectedDay.value
  if (
    chosen != null &&
    chosen.year === day.year &&
    chosen.month === day.month &&
    chosen.day === day.day
  )
    emit('close')
  else emit('choose', { kind: 'date', ...day })
}

onMounted(() => nextTick(() => calendar.value?.focusDay()))
</script>

<template>
  <PickerMenuFrame class="DateMenu" ariaLabel="Pick a date" @close="emit('close')">
    <ul class="relative">
      <li v-for="relative in RELATIVE_CHOICES" :key="relative.kind">
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === relative.kind }"
          :data-choice="relative.kind"
          @click="emit('choose', relative)"
        >
          {{ dateExpressionCode(relative) }}
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <DateCalendar ref="calendar" :selected="selectedDay" :shown="shownDay" @pick="chooseDay" />
  </PickerMenuFrame>
</template>
