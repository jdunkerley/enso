<script setup lang="ts">
/**
 * @file The time-of-day widget's menu: `Now`, a divider, a time field of hours and minutes (with
 * seconds when asked for), columns of hours and minutes to pick from, and Cancel and Set. It knows
 * nothing of the graph: it takes the value's current choice and emits the one that is made. Choosing
 * writes nothing here; `WidgetTimeOfDay.vue` does that.
 *
 * The field is Reka's `TimeField` (as the dashboard's time inputs are): digits fill a segment,
 * ArrowUp and ArrowDown change it, ArrowLeft and ArrowRight move between segments. The columns
 * (`TimeColumns.vue`) show the same time: a click on a value changes it, as typing does, and typing
 * scrolls the columns to it. Set writes the time as it stands. Enter in the field, leaving the field,
 * or a click outside the menu (the shell calls the handler given to `registerAccept`) writes it only
 * if it was edited; Cancel and Escape ask to close without it. A segment that was cleared makes the
 * time incomplete: nothing is written until it is filled in again.
 */
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { Time } from '@internationalized/date'
import { TimeFieldInput, TimeFieldRoot } from 'reka-ui'
import TimeColumns from './TimeColumns.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { localNow, type HourMinuteSecond, type TimeChoice } from './timeExpression'

const props = defineProps<{
  /** What the value holds now; `undefined` for an unset argument. */
  choice: TimeChoice | undefined
  /** The time the field shows for `Now` or an unset argument; the browser's by default. A test sets it. */
  now?: HourMinuteSecond | undefined
  /**
   * Called once with the function that writes the field's time, for the shell's click-outside path:
   * the shell ends the interaction on the click and the menu would unmount before the field's blur.
   */
  registerAccept?: ((accept: () => void) => void) | undefined
}>()
const emit = defineEmits<{
  choose: [choice: TimeChoice]
  close: []
}>()

const root = useTemplateRef('root')
const field = useTemplateRef<HTMLElement>('field')

const toTime = ({ hour, minute, second }: HourMinuteSecond) => new Time(hour, minute, second)
const initial: HourMinuteSecond =
  props.choice?.kind === 'time' ? props.choice : (props.now ?? localNow())

const draft = shallowRef<Time | null>(toTime(initial))
const showSeconds = shallowRef(props.choice?.kind === 'time' && props.choice.second !== 0)
const granularity = computed(() => (showSeconds.value ? 'second' : 'minute'))
/** Whether the field was changed since the menu opened: only an edit is written. */
const dirty = shallowRef(false)
/** Whether a segment was cleared and not filled in again: the field then holds no time. */
const incomplete = shallowRef(false)
/** Set when the menu has chosen or closes, so that the field's blur does not write afterwards. */
let settled = false

function edit(value: unknown) {
  // Reka reports a cleared segment as `undefined`; the draft keeps the last whole time, which must not be written.
  if (!(value instanceof Time)) {
    incomplete.value = true
    return
  }
  incomplete.value = false
  // The field reports its value as it opens, too: only a different time is an edit.
  if (draft.value == null || draft.value.compare(value) !== 0) dirty.value = true
  draft.value = value
}

/** The columns' time: the field's last whole time. A pick there is an edit, as typing is. */
const columns = computed<HourMinuteSecond>({
  get: () => draft.value ?? toTime(initial),
  set: (value) => {
    incomplete.value = false
    edit(toTime(value))
  },
})

function toggleSeconds() {
  showSeconds.value = !showSeconds.value
  if (!showSeconds.value && draft.value != null) draft.value = draft.value.set({ second: 0 })
  dirty.value = true
}

function chooseNow() {
  settled = true
  emit('choose', { kind: 'now' })
}

/**
 * Write the field's time, once, if it is complete and was edited (or, with `always`, unless it is the
 * time the value holds already: Set then only closes the menu).
 */
function commit(always = false) {
  const time = draft.value
  if (settled || incomplete.value || time == null) return
  if (!dirty.value) {
    if (!always) return
    if (props.choice?.kind === 'time') return close()
  }
  settled = true
  emit('choose', {
    kind: 'time',
    hour: time.hour,
    minute: time.minute,
    second: showSeconds.value ? time.second : 0,
  })
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  // Moving between segments, or to another control of the menu, is not leaving the field.
  if (
    next instanceof Node &&
    (field.value?.contains(next) || (root.value?.$el as HTMLElement | undefined)?.contains(next))
  )
    return
  commit()
}

function close() {
  settled = true
  emit('close')
}

// A menu closed from outside (Escape is the app's cancel, a click elsewhere ends the interaction)
// unmounts with the field focused, and the browser reports that as a blur: it is not a choice.
onBeforeUnmount(() => (settled = true))

onMounted(() => {
  props.registerAccept?.(commit)
  void nextTick(() => field.value?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus())
})
</script>

<template>
  <PickerMenuFrame ref="root" class="TimeOfDayMenu" ariaLabel="Pick a time" @close="close">
    <ul class="relative">
      <li>
        <button
          type="button"
          class="item"
          :class="{ selected: props.choice?.kind === 'now' }"
          data-choice="now"
          @click="chooseNow"
        >
          Time_Of_Day.now
        </button>
      </li>
    </ul>
    <hr class="divider" />
    <div ref="field" class="field" @focusout="onFocusOut">
      <TimeFieldRoot
        v-slot="{ segments }"
        :modelValue="draft"
        :granularity="granularity"
        :hourCycle="24"
        aria-label="Time"
        class="timeField"
        @keydown.enter.prevent="commit()"
        @update:modelValue="edit"
      >
        <template v-for="(segment, i) in segments" :key="i">
          <TimeFieldInput :part="segment.part" class="segment" :class="segment.part">
            {{ segment.value }}
          </TimeFieldInput>
        </template>
      </TimeFieldRoot>
      <button type="button" class="secondsToggle" data-action="seconds" @click="toggleSeconds">
        {{ showSeconds ? 'Hide seconds' : 'Add seconds' }}
      </button>
    </div>
    <TimeColumns v-model="columns" :seconds="showSeconds" class="columns" />
    <div class="actions">
      <button type="button" class="action" data-action="cancel" @click="close">Cancel</button>
      <button type="button" class="action set" data-action="set" @click="commit(true)">Set</button>
    </div>
  </PickerMenuFrame>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
}

.timeField {
  display: flex;
  align-items: center;
}

.segment {
  min-width: 1.4em;
  padding: 1px 2px;
  text-align: center;
  border-radius: 4px;

  &.literal {
    min-width: 0;
    padding: 0;
  }

  &:focus,
  &:focus-visible {
    outline: none;
    background-color: var(--dropdown-item-selected-bg);
  }

  &[data-placeholder] {
    opacity: 0.5;
  }
}

.columns {
  margin-top: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 6px;
}

.action {
  height: var(--item-height);
  padding: 0 12px;
  border-radius: calc(var(--item-height) / 2);

  &:hover,
  &:focus-visible {
    background-color: var(--dropdown-item-hover-bg);
  }

  &.set {
    background-color: var(--dropdown-item-selected-bg);
  }
}

.secondsToggle {
  opacity: 0.6;
  font-size: 0.9em;

  &:hover,
  &:focus-visible {
    opacity: 1;
  }
}
</style>
