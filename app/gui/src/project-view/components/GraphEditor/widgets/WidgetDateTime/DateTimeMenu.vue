<script setup lang="ts">
/**
 * @file The date-time widget's menu: `Date_Time.now`, the calendar (the date menu's) and the time
 * field (the time-of-day menu's, hours and minutes). A day is written at the field's time, and a
 * time on the value's day (today's for `now` or an unset value). Like the time-of-day menu, an
 * edited time is written by Enter, by leaving the menu, or by a click outside it (the shell calls
 * the handler given to `registerAccept`); Escape closes without it. It writes nothing itself:
 * `WidgetDateTime.vue` does that.
 */
import DateCalendar from '@/components/GraphEditor/widgets/WidgetDate/DateCalendar.vue'
import type { YearMonthDay } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import TimeField from '@/components/GraphEditor/widgets/WidgetTimeOfDay/TimeField.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { localDateTimeNow, type DateTimeChoice, type DateTimeParts } from './dateTimeExpression'

const props = defineProps<{
  /** The argument's current choice, if it is one. */
  choice: DateTimeChoice | undefined
  /** The date and time `Date_Time.now` and an unset value stand for; the browser's by default. A test sets it. */
  now?: DateTimeParts | undefined
  /** As `TimeOfDayMenu`'s: the shell calls the handler on a click outside the menu. */
  registerAccept?: ((accept: () => void) => void) | undefined
}>()
const emit = defineEmits<{ choose: [choice: DateTimeChoice]; close: [] }>()

const root = useTemplateRef('root')
const calendar = useTemplateRef<InstanceType<typeof DateCalendar>>('calendar')
const field = useTemplateRef<InstanceType<typeof TimeField>>('field')

/** The date and time the menu opens on: the value's, or now's. */
const base: DateTimeParts =
  props.choice?.kind === 'dateTime' ? props.choice : (props.now ?? localDateTimeNow())
const selectedDay = computed<YearMonthDay | undefined>(() =>
  props.choice?.kind === 'dateTime' ? props.choice : undefined,
)
const initialTime = { hour: base.hour, minute: base.minute, second: 0 }
/** Set once the menu has chosen or closes, so a later blur writes nothing. */
let settled = false

function choose(parts: DateTimeParts) {
  settled = true
  emit('choose', { kind: 'dateTime', ...parts })
}

function chooseNow() {
  settled = true
  emit('choose', { kind: 'now' })
}

/** A day keeps the time in the field, edited or not; the chosen day without a time edit only closes. */
function chooseDay(day: YearMonthDay) {
  if (settled) return
  const time = field.value?.currentTime() ?? initialTime
  const edited = field.value?.editedTime() != null
  const chosen = selectedDay.value
  if (
    !edited &&
    chosen != null &&
    chosen.year === day.year &&
    chosen.month === day.month &&
    chosen.day === day.day
  ) {
    close()
    return
  }
  choose({ ...day, hour: time.hour, minute: time.minute })
}

/** Write the field's time on the value's day (or today's), once, if it was edited and is complete. */
function commitTime() {
  const time = field.value?.editedTime()
  if (settled || time == null) return
  choose({
    year: base.year,
    month: base.month,
    day: base.day,
    hour: time.hour,
    minute: time.minute,
  })
}

function onLeave(next: EventTarget | null) {
  if (next instanceof Node && (root.value?.$el as HTMLElement | undefined)?.contains(next)) return
  commitTime()
}

function close() {
  settled = true
  emit('close')
}

onBeforeUnmount(() => (settled = true))
onMounted(() => {
  props.registerAccept?.(commitTime)
  void nextTick(() => calendar.value?.focusDay())
})
</script>

<template>
  <PickerMenuFrame ref="root" class="DateTimeMenu" ariaLabel="Pick a date and time" @close="close">
    <ul class="relative">
      <li>
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === 'now' }"
          data-choice="now"
          @click="chooseNow"
        >
          Date_Time.now
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <DateCalendar ref="calendar" :selected="selectedDay" :shown="base" @pick="chooseDay" />
    <hr class="divider" />
    <TimeField
      ref="field"
      :initial="initialTime"
      :initialShowSeconds="false"
      :secondsToggle="false"
      @enter="commitTime"
      @leave="onLeave"
    />
  </PickerMenuFrame>
</template>
