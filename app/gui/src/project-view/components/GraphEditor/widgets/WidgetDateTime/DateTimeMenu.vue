<script setup lang="ts">
/**
 * @file The date-time widget's menu: `Date_Time.now`, then side by side the calendar (the date
 * menu's) and the time field and its columns (the time-of-day menu's `TimeField`: hours and
 * minutes, seconds on request, as tall as the calendar), then Cancel and Set under both. It writes
 * nothing itself: `WidgetDateTime.vue` does that.
 *
 * `Date_Time.now` writes at once. A click on a day or on a column value selects it and writes
 * nothing; Set writes the selected day (the value's, or today's for `now` or an unset value) at the
 * field's time, or only closes when neither was changed on a written value; Enter on a day does what
 * Set does. Enter in the field writes if the day or the time was changed, as does leaving the menu
 * or a click outside it (the shell calls the handler given to `registerAccept`); Cancel and Escape
 * close without writing.
 * A cleared segment makes the time incomplete, and nothing is written until it is filled in.
 */
import DateCalendar from '@/components/GraphEditor/widgets/WidgetDate/DateCalendar.vue'
import type { YearMonthDay } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import PickerActions from '@/components/GraphEditor/widgets/WidgetPicker/PickerActions.vue'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import TimeField from '@/components/GraphEditor/widgets/WidgetTimeOfDay/TimeField.vue'
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
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
/** The day marked as selected: the value's, until another is clicked; none for `now` or unset. */
const selectedDay = shallowRef<YearMonthDay | undefined>(
  props.choice?.kind === 'dateTime' ? props.choice : undefined,
)
/** Whether a day other than the opening one was selected. */
const dayEdited = shallowRef(false)
const initialTime = { hour: base.hour, minute: base.minute, second: base.second }
const initialShowSeconds = props.choice?.kind === 'dateTime' && props.choice.second !== 0
/** Set once the menu has chosen or closes, so a later blur writes nothing. */
let settled = false

function selectDay(day: YearMonthDay) {
  const current = selectedDay.value ?? base
  if (current.year !== day.year || current.month !== day.month || current.day !== day.day)
    dayEdited.value = true
  selectedDay.value = day
}

function chooseNow() {
  settled = true
  emit('choose', { kind: 'now' })
}

/**
 * Write the selected day at the field's time, once, if the time is complete and the day or the
 * time was changed (or, with `always`, unless the value is written and neither was: Set then only
 * closes the menu).
 */
function commit(always = false) {
  if (settled || field.value == null) return
  const time = field.value.currentTime()
  if (time == null) return
  const edited = dayEdited.value || field.value.editedTime() != null
  if (!edited) {
    if (!always) return
    if (props.choice?.kind === 'dateTime') return close()
  }
  const day = selectedDay.value ?? base
  settled = true
  emit('choose', {
    kind: 'dateTime',
    year: day.year,
    month: day.month,
    day: day.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  })
}

function onLeave(next: EventTarget | null) {
  if (next instanceof Node && (root.value?.$el as HTMLElement | undefined)?.contains(next)) return
  commit()
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
    <div class="panels">
      <DateCalendar
        ref="calendar"
        class="calendarPanel"
        :selected="selectedDay"
        :shown="base"
        @pick="selectDay"
        @enter="commit(true)"
      />
      <TimeField
        ref="field"
        class="timePanel"
        :initial="initialTime"
        :initialShowSeconds="initialShowSeconds"
        fill
        @enter="commit()"
        @leave="onLeave"
      />
    </div>
    <PickerActions @cancel="close" @set="commit(true)" />
  </PickerMenuFrame>
</template>

<style scoped>
/* The calendar on the left (the date menu's width), the time on the right with its columns as tall
 * as the calendar, and Cancel and Set under both. A fixed width, as every picker menu has. */
.DateTimeMenu {
  --picker-menu-width: 380px;
}

.panels {
  display: flex;
  gap: 8px;
}

.calendarPanel {
  flex: none;
  width: 186px;
}

.timePanel {
  flex: 1;
  min-width: 0;
}
</style>
