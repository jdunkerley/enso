<script setup lang="ts">
/**
 * @file A block of text that copies itself to the clipboard when pressed: the Vue counterpart of
 * the React `CopyBlock`, styled by the same `COPY_BLOCK_STYLES`, with the same toast.
 */
import Button from '$/components/Button/Button.vue'
import { useCopy } from '$/components/Button/copy'
import { COPY_BLOCK_STYLES } from '$/components/CopyBlock/variants'
import { useText } from '$/providers/text'
import { computed } from 'vue'

const { copyText, class: className } = defineProps<{
  copyText: string
  class?: string | undefined
}>()

const emit = defineEmits<{ copy: [] }>()

const { getText } = useText()
const { state, copy } = useCopy({ onCopy: () => emit('copy') })
const styles = computed(() => COPY_BLOCK_STYLES())
</script>

<template>
  <Button
    variant="custom"
    size="custom"
    :tooltip="state === 'success' ? getText('copied') : getText('copy')"
    :class="styles.base({ className })"
    @press="copy(copyText)"
  >
    <span :class="styles.copyTextBlock()">{{ copyText }}</span>
  </Button>
</template>
