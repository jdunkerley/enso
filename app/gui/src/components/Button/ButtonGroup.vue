<script setup lang="ts">
/**
 * @file A row (or column) of buttons: the Vue counterpart of the React `Button.Group`, styled by
 * the same `BUTTON_GROUP_STYLES`.
 *
 * `buttonVariants` sets shared props for every `Button.vue` inside, which their own props
 * override. With `gap: 'joined'` the buttons are joined into one control, each told whether it is
 * the first, a middle or the last one (`Button.GroupJoin` in React).
 */
import { BUTTON_GROUP_STYLES } from '$/components/Button/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed, useSlots, type VNode } from 'vue'
import {
  flattenSlotChildren,
  provideButtonGroup,
  provideJoinedButton,
  type ButtonGroupSharedProps,
  type JoinedPosition,
} from './buttonGroup'
import JoinedButtonPosition from './JoinedButtonPosition.vue'

type ButtonGroupVariants = VariantProps<typeof BUTTON_GROUP_STYLES>

const {
  gap,
  wrap = undefined,
  direction,
  width,
  align,
  verticalAlign,
  buttonVariants = {},
  testId,
  class: className,
} = defineProps<{
  gap?: ButtonGroupVariants['gap']
  wrap?: boolean | undefined
  direction?: ButtonGroupVariants['direction']
  width?: ButtonGroupVariants['width']
  align?: ButtonGroupVariants['align']
  verticalAlign?: ButtonGroupVariants['verticalAlign']
  buttonVariants?: ButtonGroupSharedProps | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const isJoined = computed(() => gap === 'joined')

provideButtonGroup(() => buttonVariants)
// A group nested in a joined group starts afresh, as React's `ResetButtonGroupContext` does.
provideJoinedButton(undefined)

const slots = useSlots()

/** The buttons of a joined group, each with its position. Called while rendering. */
function joinedChildren(): { node: VNode; position: JoinedPosition | undefined }[] {
  const nodes = flattenSlotChildren(slots.default?.() ?? [])
  return nodes.map((node, index) => ({
    node,
    position:
      nodes.length === 1 ? undefined
      : index === 0 ? 'first'
      : index === nodes.length - 1 ? 'last'
      : 'middle',
  }))
}
</script>

<template>
  <div
    :class="BUTTON_GROUP_STYLES({ gap, wrap, direction, align, verticalAlign, width, className })"
    :data-testid="testId"
  >
    <template v-if="isJoined">
      <JoinedButtonPosition
        v-for="({ node, position }, index) in joinedChildren()"
        :key="node.key ?? index"
        :position="position"
      >
        <component :is="node" />
      </JoinedButtonPosition>
    </template>
    <slot v-else />
  </div>
</template>
