<script setup lang="ts">
/** @file One action in a `DropdownMenu`; the Vue counterpart of the React `Menu.Item`. */
import { DropdownMenuItem } from 'reka-ui'
import { MENU_ITEM_STYLES } from './variants'

const { disabled = false, testId } = defineProps<{
  disabled?: boolean
  testId?: string
}>()

const emit = defineEmits<{
  /** The item was chosen, by click, Enter or Space. The menu closes afterwards. */
  select: []
}>()

const styles = MENU_ITEM_STYLES()
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    :class="styles.base()"
    :data-testid="testId"
    @select="emit('select')"
  >
    <span :class="styles.title()"><slot /></span>
  </DropdownMenuItem>
</template>
