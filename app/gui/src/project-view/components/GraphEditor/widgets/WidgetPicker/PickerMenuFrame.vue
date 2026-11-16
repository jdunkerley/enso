<script setup lang="ts">
/**
 * @file The frame of a widget's menu, shared by the date and time-of-day menus: a rounded dropdown
 * dialog that keeps its keys, clicks and wheel to itself, and asks to close on Escape. The slot
 * holds `.item` buttons (full-width rows) and `.divider` rules, which the frame styles.
 */
defineProps<{ ariaLabel: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    class="PickerMenuFrame"
    role="dialog"
    :aria-label="ariaLabel"
    @keydown.escape.stop.prevent="emit('close')"
    @keydown.stop
    @click.stop
    @wheel.stop.passive
  >
    <slot />
  </div>
</template>

<style scoped>
.PickerMenuFrame {
  --item-height: 23px;
  --dropdown-padding: 6px;
  min-width: 200px;
  padding: var(--dropdown-padding);
  user-select: none;
  background-color: var(--dropdown-bg);
  color: var(--dropdown-fg);
  border: 1px solid color-mix(in oklab, var(--dropdown-bg), black 5%);
  border-radius: calc(var(--item-height) / 2 + var(--dropdown-padding));
}

.PickerMenuFrame :deep(.item) {
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--item-height);
  padding: 0 8px;
  border-radius: calc(var(--item-height) / 2);
  text-align: left;

  &:hover,
  &:focus-visible {
    background-color: var(--dropdown-item-hover-bg);
  }

  &.selected {
    background-color: var(--dropdown-item-selected-bg);
  }
}

.PickerMenuFrame :deep(.divider) {
  margin: 4px 0;
  border: none;
  border-top: 1px solid color-mix(in oklab, var(--dropdown-bg), black 12%);
}
</style>
