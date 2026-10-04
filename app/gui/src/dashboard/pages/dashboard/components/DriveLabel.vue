<script setup lang="ts">
/**
 * @file A label in its colour, pressable, with an optional button to remove it: the Vue port of
 * React's `Label`, for the drive's labels column and the asset search bar. (The React one stays for
 * the labels popover until #198; the Properties tab has its own never-pressable copy.)
 *
 * The text is the default slot, always plain text here (React took other content too, which no
 * caller passed). React's `react-aria-Button` class stays on the inner button, as
 * react-aria rendered it, and the focus ring shows on the wrapper while anything in it has visible
 * focus, as React's `FocusRing within placement="after"` did.
 */
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import Button from '$/components/Button/Button.vue'
import Text from '$/components/Text/Text.vue'
import { useFocusRing } from '$/composables/focusRing'
import { twJoin, twMerge } from '$/utils/style/tailwindMerge'
import {
  lChColorToCssColor,
  type Label as BackendLabel,
  type LChColor,
} from 'enso-common/src/services/Backend'
import { ref } from 'vue'

const {
  color,
  active = false,
  isDisabled = false,
  title,
  label,
  testId,
  onPress,
  onDelete,
} = defineProps<{
  color: LChColor
  /** When true, the label is not faded out even when not hovered. */
  active?: boolean | undefined
  /** When true, the label cannot be pressed. */
  isDisabled?: boolean | undefined
  title?: string | undefined
  label?: BackendLabel | undefined
  testId?: string | undefined
  onPress?: ((label?: BackendLabel) => void) | undefined
  onDelete?: (() => Promise<void> | void) | undefined
}>()

const root = ref<HTMLElement>()
const focusRing = useFocusRing(root, { within: true, placement: 'after' })
</script>

<script lang="ts">
const MAXIMUM_LIGHTNESS_FOR_DARK_COLORS = 50
</script>

<template>
  <div ref="root" :class="twJoin('relative rounded-full', focusRing)">
    <div
      :title="title"
      :class="
        twMerge(
          'relative flex h-6 items-center whitespace-nowrap rounded-inherit px-[7px] opacity-50 transition-all hover:opacity-100 focus:opacity-100',
          onPress == null && 'cursor-default',
          active && 'active',
        )
      "
      :style="{ backgroundColor: lChColorToCssColor(color) }"
    >
      <button
        :data-testid="testId"
        type="button"
        class="react-aria-Button"
        :disabled="isDisabled"
        :data-disabled="isDisabled ? 'true' : undefined"
        v-bind="STOP_PRESS_PROPAGATION"
        @click="onPress?.(label)"
      >
        <Text
          truncate="1"
          class="max-w-24"
          :color="color.lightness > MAXIMUM_LIGHTNESS_FOR_DARK_COLORS ? 'primary' : 'invert'"
          variant="body"
        >
          <slot />
        </Text>
      </button>
      <Button
        v-if="onDelete != null"
        icon="close"
        variant="icon"
        size="small"
        v-bind="STOP_PRESS_PROPAGATION"
        :class="
          twJoin('ml-2', color.lightness <= MAXIMUM_LIGHTNESS_FOR_DARK_COLORS && 'text-white')
        "
        @press="onDelete"
      />
    </div>
  </div>
</template>
