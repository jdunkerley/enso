<script setup lang="ts">
/** @file The small, faded button that adds or edits a version's comment. */
import Button from '$/components/Button/Button.vue'

const {
  icon,
  label,
  isUpdating = false,
  onPress,
} = defineProps<{
  icon: 'comment' | 'edit'
  label: string
  isUpdating?: boolean | undefined
  onPress: () => void
}>()
</script>

<template>
  <Button
    size="xsmall"
    variant="icon"
    :icon="icon"
    class="opacity-30 transition-opacity hover:opacity-100 focus-visible:opacity-100"
    :aria-label="label"
    :isLoading="isUpdating"
    :isDisabled="isUpdating"
    @press="onPress"
  />
</template>
