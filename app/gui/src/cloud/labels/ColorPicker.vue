<script setup lang="ts">
/**
 * @file A choice of one of the label colours (`COLORS`): the Vue port of the React
 * `#/components/ColorPicker`, with its markup and classes. It is a `role="radiogroup"` of native
 * radios hidden in round swatches, as react-aria rendered it, so arrow keys move the choice as the
 * browser does. The chosen swatch shows a dot; a swatch focused from the keyboard shows the focus
 * ring. `v-model` holds the colour.
 */
import { twMerge } from '$/utils/style/tailwindMerge'
import {
  COLOR_STRING_TO_COLOR,
  COLORS,
  lChColorToCssColor,
  type LChColor,
} from 'enso-common/src/services/Backend'
import { computed, ref, useId } from 'vue'

const { class: className, pickerClass } = defineProps<{
  class?: string | undefined
  pickerClass?: string | undefined
}>()

const color = defineModel<LChColor | undefined>()

const name = useId()
const selected = computed(() => (color.value == null ? null : lChColorToCssColor(color.value)))
const focusVisible = ref<string | null>(null)

function onChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  const newColor = COLOR_STRING_TO_COLOR.get(value)
  if (newColor != null) color.value = newColor
}

function onFocus(event: FocusEvent, cssColor: string) {
  focusVisible.value = (event.target as HTMLElement).matches(':focus-visible') ? cssColor : null
}
</script>

<template>
  <div role="radiogroup" aria-orientation="horizontal" :class="twMerge('flex flex-col', className)">
    <slot />
    <div :class="twMerge('flex items-center justify-between gap-colors', pickerClass)">
      <label
        v-for="(currentColor, i) in COLORS"
        :key="i"
        :class="[
          'group flex h-6 w-6 cursor-pointer items-center justify-center rounded-full',
          focusVisible === lChColorToCssColor(currentColor) && 'focus-ring',
        ]"
        :style="{ backgroundColor: lChColorToCssColor(currentColor) }"
        :data-selected="selected === lChColorToCssColor(currentColor) || undefined"
      >
        <input
          type="radio"
          class="sr-only"
          :name="name"
          :value="lChColorToCssColor(currentColor)"
          :checked="selected === lChColorToCssColor(currentColor)"
          @change="onChange"
          @focus="onFocus($event, lChColorToCssColor(currentColor))"
          @blur="focusVisible = null"
        />
        <div
          class="hidden aspect-square h-3 w-3 rounded-full bg-selected-frame group-data-[selected]:block"
        />
      </label>
    </div>
  </div>
</template>
