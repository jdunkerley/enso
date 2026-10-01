<script setup lang="ts">
/**
 * @file A menu of actions opened from a trigger: the Vue counterpart of the React
 * `#/components/Menu` + `Menu.Trigger`, built on Reka UI's `DropdownMenu`.
 *
 * Reka provides the accessibility behaviour react-aria provided on the React side: `menu` /
 * `menuitem` roles, focus moved into the menu on open and back to the trigger on close, arrow-key
 * navigation with typeahead, Escape and outside-click dismissal.
 */
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  type DropdownMenuContentProps,
} from 'reka-ui'
import { computed } from 'vue'
import { MENU_STYLES } from './variants'

const {
  variant = 'light',
  side = 'bottom',
  align = 'start',
  testId,
} = defineProps<{
  variant?: 'light' | 'dark'
  side?: DropdownMenuContentProps['side']
  align?: DropdownMenuContentProps['align']
  testId?: string
}>()

const open = defineModel<boolean>('open', { default: false })

/**
 * Render into the same root as the React overlays (`index.html`), so both frameworks' popups share
 * one stacking context and the dashboard's base styles (`:where(.enso-portal-root)`).
 */
const portalTarget = computed(() => document.getElementById('enso-portal-root') ?? 'body')
const classes = computed(() => MENU_STYLES({ variant }))
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger asChild>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal :to="portalTarget">
      <DropdownMenuContent
        :side="side"
        :align="align"
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
