<script setup lang="ts">
/**
 * @file Scrollable columns of hours (0–23) and minutes (0–59), and of seconds when `seconds` is set,
 * to pick a time from. A click on a value selects it (the v-model changes); it writes nothing. The
 * selected value of each column is highlighted, and is scrolled to the middle of its column when the
 * columns appear and whenever the v-model changes from outside (the time field above them).
 *
 * It holds a plain `HourMinuteSecond`, so any time picker (time of day, date and time) can use it.
 * The values are not focusable, and a press on one does not move the focus: the keyboard stays in
 * the field, so Enter there still writes what was picked here.
 */
import { nextTick, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { HourMinuteSecond } from './timeExpression'

const model = defineModel<HourMinuteSecond>({ required: true })
const props = defineProps<{
  /** Whether to show the seconds column. */
  seconds?: boolean
}>()

type Unit = keyof HourMinuteSecond
const COLUMNS: readonly { unit: Unit; label: string; count: number }[] = [
  { unit: 'hour', label: 'Hour', count: 24 },
  { unit: 'minute', label: 'Minute', count: 60 },
  { unit: 'second', label: 'Second', count: 60 },
]

const root = useTemplateRef<HTMLElement>('root')
/**
 * The time shown: the v-model, and a pick at once (two picks before the owner has passed the first
 * back must not lose it).
 */
const shown = shallowRef(model.value)
watch(model, (value) => (shown.value = value))
/** Set by a click here: the clicked value is in view already, and must not jump to the middle. */
let picked = false

function pick(unit: Unit, value: number) {
  if (shown.value[unit] === value) return
  picked = true
  shown.value = { ...shown.value, [unit]: value }
  model.value = shown.value
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Scroll each column so that its selected value is in its middle. */
function centreSelected() {
  for (const column of root.value?.querySelectorAll<HTMLElement>('.column') ?? []) {
    const selected = column.querySelector<HTMLElement>('[aria-selected="true"]')
    if (selected == null) continue
    column.scrollTop = selected.offsetTop - (column.clientHeight - selected.offsetHeight) / 2
  }
}

watch(
  [() => shown.value.hour, () => shown.value.minute, () => shown.value.second, () => props.seconds],
  () => {
    if (picked) picked = false
    else void nextTick(centreSelected)
  },
)
onMounted(centreSelected)
</script>

<template>
  <div ref="root" class="TimeColumns">
    <template v-for="column in COLUMNS" :key="column.unit">
      <ul
        v-if="column.unit !== 'second' || props.seconds"
        class="column"
        role="listbox"
        :aria-label="column.label"
        :data-unit="column.unit"
      >
        <li
          v-for="value in column.count"
          :key="value"
          class="value"
          role="option"
          :aria-selected="shown[column.unit] === value - 1"
          @pointerdown.prevent
          @click="pick(column.unit, value - 1)"
        >
          {{ pad(value - 1) }}
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.TimeColumns {
  --visible-values: 5;
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: calc(var(--item-height, 23px) / 2 + 4px);
  background-color: color-mix(in oklab, var(--dropdown-bg), black 4%);
}

.column {
  /* The values are scrolled into the middle: `offsetTop` is measured from the column. */
  position: relative;
  flex: 1;
  height: calc(var(--item-height, 23px) * var(--visible-values));
  overflow-y: auto;
  scrollbar-width: none;
}

.value {
  height: var(--item-height, 23px);
  line-height: var(--item-height, 23px);
  text-align: center;
  border-radius: calc(var(--item-height, 23px) / 2);
  cursor: pointer;
  font-variant-numeric: tabular-nums;

  &:hover {
    background-color: var(--dropdown-item-hover-bg);
  }

  &[aria-selected='true'] {
    background-color: var(--dropdown-item-selected-bg);
  }
}
</style>
