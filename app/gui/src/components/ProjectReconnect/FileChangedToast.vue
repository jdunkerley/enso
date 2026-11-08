<script setup lang="ts">
/**
 * @file The content of the toast that says a module's file changed while its project reconnected,
 * so the user's unsaved changes were not put back: Keep the file, or Restore my version. What each
 * does is up to the caller.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'

const { file, onKeep, onRestore } = defineProps<{
  file: string
  onKeep: () => unknown
  onRestore: () => unknown
}>()

const { getText } = useText()
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="file-changed-toast">
    <Text>{{ getText('projectFileChangedOnReconnect', file) }}</Text>
    <ButtonGroup class="grow-0">
      <Button size="small" variant="outline" @press="onKeep">
        {{ getText('projectFileKeep') }}
      </Button>
      <Button size="small" variant="outline" @press="onRestore">
        {{ getText('projectFileRestoreMine') }}
      </Button>
    </ButtonGroup>
  </div>
</template>
