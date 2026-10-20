<script setup lang="ts">
/**
 * @file The content of the toast that says a secret was created from the Drive bar: its
 * `secret://` path, which is how a workflow refers to it, and a Copy button for that path.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { path } = defineProps<{ path: string }>()

const { getText } = useText()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(path)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="new-secret-toast">
    <Text>{{ getText('secretCreated', path) }}</Text>
    <ButtonGroup class="grow-0">
      <Button size="small" variant="outline" @press="copy">
        {{ copied ? getText('copied') : getText('copy') }}
      </Button>
    </ButtonGroup>
  </div>
</template>
