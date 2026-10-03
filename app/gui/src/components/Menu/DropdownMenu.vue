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
 *
 * An item that opens a dialog keeps the focus in that dialog, as react-aria's menus do: Reka would
 * return the focus to the trigger once the menu's exit animation ended, and the dialog's focus trap
 * then took it back without showing it (an `AlertDialog`'s confirm button lost its focused look).
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
import { MENU_CONTAINER_PADDING, MENU_STYLES } from './variants'

const {
  variant = 'light',
  placement = 'bottom-start',
  offset = 4,
  testId,
  class: className,
} = defineProps<{
  variant?: 'dark' | 'light' | undefined
  placement?: Placement | undefined
  /** Distance from the trigger, in pixels. React's menus use react-aria's default, 8. */
  offset?: number | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const sideAlign = computed(() => placementToSideAlign(placement))

/** Leave the focus where it is when an item opened a dialog that now has it. */
function onCloseAutoFocus(event: Event) {
  if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]') != null) {
    event.preventDefault()
  }
}
const classes = computed(() => MENU_STYLES({ variant, className }))

/**
 * Return focus to the trigger on closing, unless an item opened a dialog that has taken it (a
 * confirmation on the modal stack): taking it back would make the dialog's focus trap pull it in
 * again, without the focus ring the dialog gave its own control. The dialog returns focus to the
 * trigger when it closes (`$/components/Dialog/focusReturn`).
 */
function onCloseAutoFocus(event: Event) {
  const focused = document.activeElement
  if (focused?.closest('[role="dialog"], [role="alertdialog"]') != null) event.preventDefault()
}
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
        :sideOffset="offset"
        :collisionPadding="MENU_CONTAINER_PADDING"
        :class="classes"
        :data-testid="testId"
        loop
        @closeAutoFocus="onCloseAutoFocus"
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
