<script setup lang="ts">
/**
 * @file The content of the toast that says unsaved changes were put back after a project
 * reconnected, with an Undo button when the module's text was put back (the file may have been
 * reverted on purpose while the connection was down). What Undo does is up to the caller.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'

const { message, onUndo } = defineProps<{
  message: string
  onUndo?: (() => unknown) | undefined
}>()

const { getText } = useText()
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="changes-restored-toast">
    <Text>{{ message }}</Text>
    <ButtonGroup v-if="onUndo" class="grow-0">
      <Button size="small" variant="outline" @press="onUndo">
        {{ getText('projectRestoreUndo') }}
      </Button>
    </ButtonGroup>
  </div>
</template>
