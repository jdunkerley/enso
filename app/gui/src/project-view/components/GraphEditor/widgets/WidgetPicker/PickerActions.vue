<script setup lang="ts">
/**
 * @file A picker menu's Cancel and Set buttons, shared by the time-of-day and date-time menus: Set
 * asks to write the time the menu shows, Cancel to close without writing. What either does is the
 * menu's business.
 */
const emit = defineEmits<{ cancel: []; set: [] }>()
</script>

<template>
  <div class="PickerActions">
    <button type="button" class="action" data-action="cancel" @click="emit('cancel')">
      Cancel
    </button>
    <button type="button" class="action set" data-action="set" @click="emit('set')">Set</button>
  </div>
</template>

<style scoped>
.PickerActions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 6px;
}

.action {
  height: var(--item-height);
  padding: 0 12px;
  border-radius: calc(var(--item-height) / 2);

  &:hover,
  &:focus-visible {
    background-color: var(--dropdown-item-hover-bg);
  }

  &.set {
    background-color: var(--dropdown-item-selected-bg);
  }
}
</style>
