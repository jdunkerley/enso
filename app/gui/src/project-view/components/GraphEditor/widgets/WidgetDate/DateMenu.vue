<script setup lang="ts">
/**
 * @file The date widget's menu: `Date.today`, `Date.yesterday` and `Date.tomorrow`, a divider, a
 * month calendar, then Cancel and Set. It knows nothing of the graph: it takes the value's current
 * choice and emits the one that is made. Choosing writes nothing here; `WidgetDate.vue` does that.
 *
 * A relative choice writes at once. A click on a day selects it (it is marked) and writes nothing;
 * Set writes the selected day (or only closes when it is the day already written, or when no day
 * is selected). Enter on a day selects and writes it. A click outside the menu (the shell calls the
 * handler given to `registerAccept`) writes the selected day only if it was changed; Cancel and
 * Escape ask to close without it. The calendar is `DateCalendar.vue`.
 */
import PickerActions from '@/components/GraphEditor/widgets/WidgetPicker/PickerActions.vue'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
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
  /** As `TimeOfDayMenu`'s: the shell calls the handler on a click outside the menu. */
  registerAccept?: ((accept: () => void) => void) | undefined
}>()
const emit = defineEmits<{
  choose: [choice: DateChoice]
  close: []
}>()

const calendar = useTemplateRef<InstanceType<typeof DateCalendar>>('calendar')
const today = computed(() => props.today ?? localToday())

/** The day the calendar opens on. */
const shownDay = resolveChoice(props.choice ?? { kind: 'today' }, today.value)
/** The day the value holds, when it is a specific date. */
const writtenDay = props.choice?.kind === 'date' ? props.choice : undefined
/** The day marked as selected: the written one until another is clicked. */
const selectedDay = shallowRef<YearMonthDay | undefined>(writtenDay)
/** Set once the menu has chosen or closes, so a later click outside writes nothing. */
let settled = false

const sameDay = (a: YearMonthDay | undefined, b: YearMonthDay | undefined) =>
  a != null && b != null && a.year === b.year && a.month === b.month && a.day === b.day

function chooseRelative(choice: DateChoice) {
  settled = true
  emit('choose', choice)
}

/**
 * Write the selected day, once, if it differs from the written one; with `always` (Set), a day that
 * does not differ, or no selected day, only closes the menu.
 */
function commit(always = false) {
  if (settled) return
  const day = selectedDay.value
  if (day == null || sameDay(day, writtenDay)) {
    if (always) close()
    return
  }
  settled = true
  emit('choose', { kind: 'date', year: day.year, month: day.month, day: day.day })
}

function close() {
  settled = true
  emit('close')
}

onBeforeUnmount(() => (settled = true))
onMounted(() => {
  props.registerAccept?.(() => commit())
  void nextTick(() => calendar.value?.focusDay())
})
</script>

<template>
  <PickerMenuFrame class="DateMenu" ariaLabel="Pick a date" @close="close">
    <ul class="relative">
      <li v-for="relative in RELATIVE_CHOICES" :key="relative.kind">
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === relative.kind }"
          :data-choice="relative.kind"
          @click="chooseRelative(relative)"
        >
          {{ dateExpressionCode(relative) }}
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <DateCalendar
      ref="calendar"
      :selected="selectedDay"
      :shown="shownDay"
      @pick="selectedDay = $event"
      @enter="commit(true)"
    />
    <PickerActions @cancel="close" @set="commit(true)" />
  </PickerMenuFrame>
</template>
