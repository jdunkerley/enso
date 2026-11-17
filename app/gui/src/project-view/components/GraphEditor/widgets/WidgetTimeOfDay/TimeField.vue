<script setup lang="ts">
/**
 * @file The time part of the time pickers (time of day, and date and time): a time field of hours and
 * minutes, with seconds on request, and under it columns of the same time to pick from
 * (`TimeColumns.vue`). It reports its time on request and tells when Enter is pressed or the focus
 * leaves it; what to do with the time is the parent's business.
 *
 * The field is Reka's `TimeField` (as the dashboard's time inputs are): digits fill a segment,
 * ArrowUp and ArrowDown change it, ArrowLeft and ArrowRight move between segments. The columns show
 * the field's time: a click on a value changes it, as typing does (an edit, which writes nothing),
 * and typing scrolls the columns to it. A segment that was cleared makes the time incomplete: it is
 * reported as `undefined` until it is filled in again.
 */
import { Time } from '@internationalized/date'
import { TimeFieldInput, TimeFieldRoot } from 'reka-ui'
import { computed, shallowRef, useTemplateRef } from 'vue'
import TimeColumns from './TimeColumns.vue'
import type { HourMinuteSecond } from './timeExpression'

const props = withDefaults(
  defineProps<{
    /** The time the field starts with. */
    initial: HourMinuteSecond
    /** Whether the seconds segment is shown at first. */
    initialShowSeconds: boolean
    /** Whether "Add seconds"/"Hide seconds" is offered; true by default. */
    secondsToggle?: boolean
  }>(),
  { secondsToggle: true },
)
const emit = defineEmits<{
  /** Enter was pressed in the field. */
  enter: []
  /** The focus left the field (its segments and its toggle); `next` is where it went. */
  leave: [next: EventTarget | null]
}>()

const container = useTemplateRef<HTMLElement>('container')

const toTime = ({ hour, minute, second }: HourMinuteSecond) => new Time(hour, minute, second)

const draft = shallowRef<Time | null>(toTime(props.initial))
const showSeconds = shallowRef(props.initialShowSeconds)
const granularity = computed(() => (showSeconds.value ? 'second' : 'minute'))
/** Whether the field was changed since it opened. */
const dirty = shallowRef(false)
/** Whether a segment was cleared and not filled in again: the field then holds no time. */
const incomplete = shallowRef(false)

function edit(value: unknown) {
  // Reka reports a cleared segment as `undefined`; the draft keeps the last whole time, which must not be reported.
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
  get: () => draft.value ?? toTime(props.initial),
  set: (value) => edit(toTime(value)),
})

function toggleSeconds() {
  showSeconds.value = !showSeconds.value
  if (!showSeconds.value && draft.value != null) draft.value = draft.value.set({ second: 0 })
  dirty.value = true
}

function timeOf(time: Time): HourMinuteSecond {
  return {
    hour: time.hour,
    minute: time.minute,
    second: showSeconds.value ? time.second : 0,
  }
}

function currentTime(): HourMinuteSecond | undefined {
  return incomplete.value || draft.value == null ? undefined : timeOf(draft.value)
}

function editedTime(): HourMinuteSecond | undefined {
  return dirty.value ? currentTime() : undefined
}

function focus() {
  container.value?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus()
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  // Moving between segments, or to the seconds button, is not leaving the field.
  if (next instanceof Node && container.value?.contains(next)) return
  emit('leave', next)
}

defineExpose({
  /** The time, if it was edited since the field opened and is complete; seconds are 0 while hidden. */
  editedTime,
  /** The time as it stands, edited or not, if it is complete; seconds are 0 while hidden. */
  currentTime,
  /** Put the keyboard on the hour segment. */
  focus,
})
</script>

<template>
  <div ref="container" class="TimeField" @focusout="onFocusOut">
    <div class="field">
      <TimeFieldRoot
        v-slot="{ segments }"
        :modelValue="draft"
        :granularity="granularity"
        :hourCycle="24"
        aria-label="Time"
        class="timeField"
        @keydown.enter.prevent="emit('enter')"
        @update:modelValue="edit"
      >
        <template v-for="(segment, i) in segments" :key="i">
          <TimeFieldInput :part="segment.part" class="segment" :class="segment.part">
            {{ segment.value }}
          </TimeFieldInput>
        </template>
      </TimeFieldRoot>
      <button
        v-if="props.secondsToggle"
        type="button"
        class="secondsToggle"
        data-action="seconds"
        @click="toggleSeconds"
      >
        {{ showSeconds ? 'Hide seconds' : 'Add seconds' }}
      </button>
    </div>
    <TimeColumns v-model="columns" :seconds="showSeconds" class="columns" />
  </div>
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

.secondsToggle {
  opacity: 0.6;
  font-size: 0.9em;

  &:hover,
  &:focus-visible {
    opacity: 1;
  }
}

.columns {
  margin-top: 4px;
}
</style>
