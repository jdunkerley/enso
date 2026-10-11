<script setup lang="ts">
/**
 * @file A help (or info) icon button that opens a popover with more detail. The content is the
 * default slot.
 */
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import type { Placement } from '$/components/placement'

const {
  placement = 'top',
  variant = 'help',
  testId,
} = defineProps<{
  placement?: Placement | undefined
  variant?: 'help' | 'info' | undefined
  testId?: string | undefined
}>()
</script>

<template>
  <Popover :placement="placement">
    <template #trigger>
      <Button :testId="testId" :icon="variant === 'help' ? 'help' : 'info'" variant="icon" />
    </template>
    <slot />
  </Popover>
</template>
