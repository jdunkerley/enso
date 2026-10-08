<script setup lang="ts">
/**
 * @file One action in a `DropdownMenu` or `ContextMenu`.
 *
 * The title is the default slot. `icon`, `shortcut` and `description` add those parts. It works
 * in both menus because Reka's `DropdownMenuItem` and `ContextMenuItem` are the same `MenuItem`
 * underneath.
 */
import Icon from '$/components/Icon/Icon.vue'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { DropdownMenuItem } from 'reka-ui'
import { MENU_ITEM_STYLES } from './variants'

const {
  isDisabled = false,
  icon,
  shortcut,
  description,
  testId,
  class: className,
} = defineProps<{
  isDisabled?: boolean | undefined
  icon?: IconName | undefined
  /** A keyboard shortcut to display, e.g. `Mod+C`. It is only displayed, not bound. */
  shortcut?: string | undefined
  description?: string | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const emit = defineEmits<{
  /** The item was chosen, by click, Enter or Space. The menu closes afterwards. */
  select: []
}>()

const styles = MENU_ITEM_STYLES()
</script>

<template>
  <DropdownMenuItem
    :disabled="isDisabled"
    :class="styles.base({ className })"
    :data-testid="testId"
    @select="emit('select')"
  >
    <div :class="styles.row()">
      <Icon v-if="icon != null" :icon="icon" :class="styles.icon()" />
      <span v-if="description == null" :class="styles.title()"><slot /></span>
      <div v-else :class="styles.titleWithDescription()">
        <span :class="styles.title()"><slot /></span>
        <span :class="styles.description()">{{ description }}</span>
      </div>
      <kbd v-if="shortcut != null" :class="styles.shortcut()">{{ shortcut }}</kbd>
    </div>
  </DropdownMenuItem>
</template>
