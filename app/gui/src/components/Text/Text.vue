<script setup lang="ts">
/**
 * @file Text in one of the design system's type styles: the Vue counterpart of the React
 * `#/components/Text`.
 *
 * A truncated text (`truncate`) shows its full content in a visual tooltip when it overflows. The
 * tooltip is the default slot again, unless the `tooltip` prop or slot gives something else;
 * `tooltipDisplay` changes when it shows (`always`, or `never`).
 *
 * Nested texts drop their line-height compensation, as in React; `TextGroup.vue` does the same
 * for a group of sibling texts.
 */
import type { Placement } from '$/components/placement'
import { TEXT_STYLE } from '$/components/Text/variants'
import { useVisualTooltip } from '$/components/Tooltip/useVisualTooltip'
import VisualTooltipPopup from '$/components/Tooltip/VisualTooltipPopup.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed, ref, useSlots } from 'vue'
import { injectInsideText, provideInsideText } from './textContext'

type TextVariants = VariantProps<typeof TEXT_STYLE>

// The root is a fragment (the text and its tooltip), so attributes go to the text explicitly.
defineOptions({ inheritAttrs: false })

const {
  elementType = 'span',
  variant,
  weight,
  color,
  transform,
  // `undefined`, not the `false` Vue casts an absent boolean prop to: "not truncated".
  truncate = undefined,
  lineClamp = 1,
  italic,
  nowrap,
  monospace,
  balance,
  textSelection,
  disableLineHeightCompensation = false,
  align,
  // `undefined`, not the `false` Vue casts an absent `string | false` prop to.
  tooltip = undefined,
  tooltipDisplay = 'whenOverflowing',
  tooltipPlacement,
  tooltipOffset,
  tooltipCrossOffset,
  testId,
  class: className,
} = defineProps<{
  elementType?: keyof HTMLElementTagNameMap | undefined
  variant?: TextVariants['variant']
  weight?: TextVariants['weight']
  color?: TextVariants['color']
  transform?: TextVariants['transform']
  truncate?: true | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'custom' | undefined
  /** The number of lines for `truncate: 'custom'`. */
  lineClamp?: number | undefined
  italic?: boolean | undefined
  nowrap?: boolean | 'normal' | undefined
  monospace?: boolean | undefined
  balance?: boolean | undefined
  textSelection?: TextVariants['textSelection']
  disableLineHeightCompensation?: boolean | 'bottom' | 'top' | undefined
  align?: TextVariants['align']
  /** The tooltip's text; `false` disables it. Defaults to the text itself. */
  tooltip?: string | false | undefined
  tooltipDisplay?: 'always' | 'never' | 'whenOverflowing' | undefined
  tooltipPlacement?: Placement | undefined
  tooltipOffset?: number | undefined
  tooltipCrossOffset?: number | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const isInsideText = injectInsideText(true) != null
provideInsideText()

const classes = computed(() =>
  TEXT_STYLE({
    variant,
    weight,
    transform,
    monospace,
    italic,
    nowrap,
    truncate,
    color,
    balance,
    textSelection,
    disableLineHeightCompensation:
      disableLineHeightCompensation === false ? isInsideText : disableLineHeightCompensation,
    className,
    align,
  }),
)

const slots = useSlots()
const isTooltipDisabled = computed(() => {
  if (tooltip === false) return true
  switch (tooltipDisplay) {
    case 'whenOverflowing':
      return truncate == null
    case 'always':
      return tooltip == null && slots.tooltip == null && slots.default == null
    case 'never':
      return true
  }
})

const element = ref<HTMLElement>()
const { isOpen, onTooltipEnter, onTooltipLeave } = useVisualTooltip(element, {
  display: () => (tooltipDisplay === 'always' ? 'always' : 'whenOverflowing'),
  isDisabled: isTooltipDisabled,
})

/** The text's element, for a caller that measures it (React's `ref`). */
defineExpose({ element })
</script>

<template>
  <component
    :is="elementType"
    v-bind="$attrs"
    ref="element"
    :class="classes"
    :data-testid="testId"
    :style="truncate === 'custom' ? { '--line-clamp': `${lineClamp}` } : undefined"
  >
    <slot />
  </component>
  <VisualTooltipPopup
    v-if="!isTooltipDisabled"
    :target="element"
    :open="isOpen"
    :placement="tooltipPlacement"
    :offset="tooltipOffset"
    :crossOffset="tooltipCrossOffset"
    @pointerenter="onTooltipEnter"
    @pointerleave="onTooltipLeave"
  >
    <slot name="tooltip">{{ tooltip }}<slot v-if="tooltip == null" /></slot>
  </VisualTooltipPopup>
</template>
