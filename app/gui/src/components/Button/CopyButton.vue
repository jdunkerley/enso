<script setup lang="ts">
/**
 * @file A button that copies text to the clipboard, and briefly shows whether that worked: the
 * Vue counterpart of the React `Button/CopyButton`.
 *
 * The React one also shows a "copied" toast; that belongs to the toast host (#80), and a port that
 * needs it can pass `@copy`.
 */
import { useText } from '$/providers/text'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { onScopeDispose, ref, useAttrs } from 'vue'
import Button from './Button.vue'

const {
  copyText,
  copyIcon = 'duplicate',
  successIcon = 'check',
  errorIcon = 'close',
  variant = 'icon',
} = defineProps<{
  copyText: string
  /** `null` shows no icon (`false` in React). */
  copyIcon?: IconName | null | undefined
  successIcon?: IconName | undefined
  errorIcon?: IconName | undefined
  variant?: InstanceType<typeof Button>['$props']['variant']
}>()

const emit = defineEmits<{ copy: [] }>()

const { getText } = useText()
const attrs = useAttrs()

/** How long the success or error icon stays before the copy icon comes back. */
const RESET_DELAY = 2000

const state = ref<'error' | 'idle' | 'success'>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(resetTimer))

async function copy() {
  clearTimeout(resetTimer)
  try {
    await navigator.clipboard.writeText(copyText)
    state.value = 'success'
    emit('copy')
  } catch (error) {
    console.error('Could not copy to the clipboard', error)
    state.value = 'error'
  }
  resetTimer = setTimeout(() => (state.value = 'idle'), RESET_DELAY)
}
</script>

<template>
  <Button
    :variant="variant"
    :icon="
      copyIcon == null ? undefined
      : state === 'success' ? successIcon
      : state === 'error' ? errorIcon
      : copyIcon
    "
    :aria-label="attrs['aria-label'] ?? getText('copyShortcut')"
    :data-copy-state="state"
    @press="copy"
  >
    <template v-if="$slots.default" #default><slot /></template>
  </Button>
</template>
