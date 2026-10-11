<script setup lang="ts">
/**
 * @file A path to a cloud file, with the file browser under it while the field has the focus. The
 * file browser is the project view's `FileBrowserWidget.vue`, mounted directly.
 *
 * Typing changes the path at once. Choosing a file in the browser sets the path; after that, the
 * browser closes when the focus leaves the field (before a choice it stays open).
 */
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import FileBrowserWidget from '@/components/widgets/FileBrowserWidget.vue'
import { ref } from 'vue'
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

const fileBrowserPath = ref(value)
const isFileBrowserOpened = ref(false)
let hasPathBeenChanged = false
const root = ref<HTMLElement>()

const roundedInputClass = (roundBottom: boolean) =>
  twMerge(ROUNDED_INPUT_BASE_CLASSES, roundBottom ? 'rounded-input' : 'rounded-t-input')

const FILE_BROWSER_STYLES = {
  '--file-browser-min-width': '280px',
  '--z-index-file-browser': 1,
  '--file-browser-background-color': 'var(--color-dashboard-background)',
  '--file-browser-text-color': 'black',
  '--file-browser-corner-radius': 'var(--input-corner-radius)',
  '--file-browser-top-bar-color': 'var(--color-primary)',
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (next == null || !hasPathBeenChanged) return
  // Close the file browser once the focus has left this component.
  if (root.value != null && next instanceof Node && !root.value.contains(next)) {
    isFileBrowserOpened.value = false
    hasPathBeenChanged = false
  }
}

function onInput(event: Event) {
  const newValue = (event.currentTarget as HTMLInputElement).value
  fileBrowserPath.value = newValue
  emit('change', newValue)
}

function onPathAccepted(path: string) {
  fileBrowserPath.value = path
  emit('change', path)
  hasPathBeenChanged = true
}
</script>

<template>
  <div
    ref="root"
    :class="twMerge('flex flex-col', isFileBrowserOpened && 'mb-4')"
    :style="FILE_BROWSER_STYLES"
    tabindex="-1"
    @focusout="onFocusOut"
  >
    <div
      :class="[
        'relative rounded-input focus-within:focus-ring-outset',
        focusRing.isFocusVisible.value && 'focus-ring',
      ]"
      @focusin="((isFileBrowserOpened = true), focusRing.onFocus())"
      @focusout="focusRing.onBlur"
    >
      <input
        type="text"
        :readonly="readOnly"
        :value="fileBrowserPath"
        :size="1"
        :class="twMerge(roundedInputClass(!isFileBrowserOpened), validationErrorClass)"
        :placeholder="getText('enterText')"
        @input="onInput"
      />
      <FileBrowserWidget
        v-if="isFileBrowserOpened"
        type="file"
        :writeMode="true"
        :choosenPath="fileBrowserPath"
        :allowOverride="true"
        @pathAccepted="onPathAccepted"
      />
    </div>
    <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
  </div>
</template>
