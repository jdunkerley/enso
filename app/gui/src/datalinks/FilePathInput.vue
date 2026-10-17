<script setup lang="ts">
/**
 * @file A path to a file, typed or chosen with the system file dialog. Dormant until local
 * datalinks, PR 2b.
 *
 * Typing changes the path at once. "Browse…" (desktop app only) opens the system file dialog;
 * choosing a file sets the path.
 */
import Button from '$/components/Button/Button.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useFocusRing } from './focusRing'
import { ROUNDED_INPUT_BASE_CLASSES } from './variants'

const {
  readOnly = false,
  value,
  validationErrorClass,
  error,
} = defineProps<{
  readOnly?: boolean | undefined
  value: string
  validationErrorClass?: string | undefined
  /** The schema's description, shown while the value is invalid. */
  error?: string | undefined
}>()

const emit = defineEmits<{ change: [value: string] }>()

const { getText } = useText()
const focusRing = useFocusRing()

const canBrowse = window.api?.fileBrowser != null

async function browse() {
  const selected = await window.api?.fileBrowser.openFileBrowser('file', value)
  const path = selected?.[0]
  if (path != null) emit('change', path)
}

function onInput(event: Event) {
  emit('change', (event.currentTarget as HTMLInputElement).value)
}
</script>

<template>
  <div class="flex flex-col">
    <div class="flex gap-1">
      <div
        :class="[
          'relative min-w-0 grow rounded-input focus-within:focus-ring-outset',
          focusRing.isFocusVisible.value && 'focus-ring',
        ]"
        @focusin="focusRing.onFocus"
        @focusout="focusRing.onBlur"
      >
        <input
          type="text"
          :readonly="readOnly"
          :value="value"
          :size="1"
          :class="twMerge(ROUNDED_INPUT_BASE_CLASSES, 'rounded-input', validationErrorClass)"
          :placeholder="getText('enterText')"
          @input="onInput"
        />
      </div>
      <Button
        v-if="canBrowse && !readOnly"
        size="small"
        variant="outline"
        testId="file-path-browse"
        @press="browse"
      >
        {{ getText('datalinkFilePathBrowse') }}
      </Button>
    </div>
    <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
  </div>
</template>
