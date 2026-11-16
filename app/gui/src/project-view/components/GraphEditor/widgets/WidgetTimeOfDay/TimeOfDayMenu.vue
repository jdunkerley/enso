<script setup lang="ts">
/**
 * @file The time-of-day widget's menu: `Now`, a divider, then a time field of hours and minutes,
 * with seconds when asked for. It knows nothing of the graph: it takes the value's current choice and
 * emits the one that is made. Choosing writes nothing here; `WidgetTimeOfDay.vue` does that.
 *
 * The field is Reka's `TimeField` (as the dashboard's time inputs are): digits fill a segment,
 * ArrowUp and ArrowDown change it, ArrowLeft and ArrowRight move between segments. Enter in the
 * field, leaving the field, or a click outside the menu (the shell calls the handler given to
 * `registerAccept`) chooses the time as it stands if it was edited and is complete; Escape asks to
 * close without it. A segment that was cleared makes the time incomplete: nothing is written until
 * it is filled in again.
 */
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import TimeField from './TimeField.vue'
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
const field = useTemplateRef<InstanceType<typeof TimeField>>('field')
const initial: HourMinuteSecond =
  props.choice?.kind === 'time' ? props.choice : (props.now ?? localNow())
const initialShowSeconds = props.choice?.kind === 'time' && props.choice.second !== 0
/** Set when the menu has chosen or closes, so that the field's blur does not write afterwards. */
let settled = false

function chooseNow() {
  settled = true
  emit('choose', { kind: 'now' })
}

/** Write the field's time, once, if it was edited and is complete. */
function commit() {
  const time = field.value?.editedTime()
  if (settled || time == null) return
  settled = true
  emit('choose', { kind: 'time', ...time })
}

function onLeave(next: EventTarget | null) {
  // Moving to another control of the menu is not leaving it.
  if (next instanceof Node && (root.value?.$el as HTMLElement | undefined)?.contains(next)) return
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
  void nextTick(() => field.value?.focus())
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
    <TimeField
      ref="field"
      :initial="initial"
      :initialShowSeconds="initialShowSeconds"
      @enter="commit"
      @leave="onLeave"
    />
  </PickerMenuFrame>
</template>
