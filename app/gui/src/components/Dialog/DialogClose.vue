<script setup lang="ts">
/**
 * @file A `Button.vue` that closes the `Dialog.vue` or `Popover.vue` it is in, then runs its own
 * `onPress`: the Vue counterpart of the React `Dialog.Close`. Every prop falls through to the button.
 */
import Button from '$/components/Button/Button.vue'
import { injectDialogContext } from './dialogContext'

const { onPress } = defineProps<{
  onPress?: ((event: MouseEvent) => unknown) | undefined
}>()

const dialog = injectDialogContext()

function press(event: MouseEvent) {
  dialog.close()
  return onPress?.(event)
}
</script>

<template>
  <Button @press="press">
    <template v-if="$slots.default" #default><slot /></template>
  </Button>
</template>
