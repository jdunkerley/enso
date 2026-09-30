<script setup lang="ts">
/**
 * @file A menu of actions opened from a trigger: the Vue counterpart of the React
 * `#/components/Menu` + `Menu.Trigger`, built on Reka UI's `DropdownMenu`.
 *
 * Reka provides the accessibility behaviour react-aria provided on the React side: `menu` /
 * `menuitem` roles, focus moved into the menu on open and back to the trigger on close, arrow-key
 * navigation with typeahead, Escape and outside-click dismissal.
 *
 * The trigger is the `trigger` slot, replacing React's `Menu.Trigger` wrapper; the items
 * (`MenuItem`, `MenuSection`, `MenuSeparator`, `MenuSubmenu`) are the default slot.
 */
import { placementToSideAlign, type Placement } from '$/components/placement'
import { portalTarget } from '$/components/portal'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { MENU_STYLES } from './variants'

const {
  variant = 'light',
  placement = 'bottom-start',
  testId,
  class: className,
} = defineProps<{
  variant?: 'dark' | 'light' | undefined
  placement?: Placement | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const sideAlign = computed(() => placementToSideAlign(placement))
const classes = computed(() => MENU_STYLES({ variant, className }))
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger asChild>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal :to="portalTarget()">
      <DropdownMenuContent
        :side="sideAlign.side"
        :align="sideAlign.align"
        :sideOffset="4"
        :class="classes"
        :data-testid="testId"
        loop
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
