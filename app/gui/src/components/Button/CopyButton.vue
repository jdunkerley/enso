<script setup lang="ts">
/**
 * @file A button that copies text to the clipboard, and briefly shows whether that worked: the
 * Vue counterpart of the React `Button/CopyButton`.
 *
 * Like the React one, it shows a "Copied to clipboard" toast at the bottom right on success (unless
 * `successToastMessage` is `false`), which closes with the success icon; a failure shows an error
 * toast and is logged.
 */
import { useText } from '$/providers/text'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { useAttrs } from 'vue'
import Button from './Button.vue'
import { useCopy } from './copy'

const {
  copyText,
  copyIcon = 'duplicate',
  successIcon = 'check',
  errorIcon = 'close',
  variant = 'icon',
  successToastMessage = true,
} = defineProps<{
  copyText: string
  /** `null` shows no icon (`false` in React). */
  copyIcon?: IconName | null | undefined
  successIcon?: IconName | undefined
  errorIcon?: IconName | undefined
  variant?: InstanceType<typeof Button>['$props']['variant']
  /**
   * The toast shown once the text is copied: `true` for "Copied to clipboard" (the default), a
   * string for another message, `false` for none.
   */
  successToastMessage?: boolean | string | undefined
}>()

const emit = defineEmits<{ copy: [] }>()

const { getText } = useText()
const attrs = useAttrs()
const { state, copy: copyToClipboard } = useCopy({
  successToastMessage: () => successToastMessage,
  onCopy: () => emit('copy'),
})

function copy() {
  return copyToClipboard(copyText)
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
