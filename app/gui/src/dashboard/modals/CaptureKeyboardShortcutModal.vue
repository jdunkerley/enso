<script setup lang="ts">
/**
 * @file A modal capturing a keyboard shortcut: the Vue port of the React
 * `CaptureKeyboardShortcutModal`. The shortcut is the last key pressed with its modifiers; Enter
 * confirms it, unless it is already bound to something. It is meant for the modal stack
 * (`useModals().open`), and emits `close` once it has closed.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import Submit from '$/components/Form/Submit.vue'
import KeyboardShortcut from '$/components/KeyboardShortcut/KeyboardShortcut.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import {
  modifierFlagsForEvent,
  modifiersForModifierFlags,
  normalizedKeyboardSegmentLookup,
} from '@/util/shortcuts'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'

const { description, existingShortcuts, onSubmit } = defineProps<{
  /** What the shortcut is for, quoted in the prompt. */
  description: string
  existingShortcuts: ReadonlySet<string>
  onSubmit: (shortcut: string) => void
}>()

const emit = defineEmits<{ close: [] }>()

const DISALLOWED_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])
const DELETE_KEY = isOnMacOS() ? 'Backspace' : 'Delete'

/** The key and modifiers of a keyboard event, as a shortcut's parts. */
function eventToPartialShortcut(event: KeyboardEvent) {
  const modifiers = modifiersForModifierFlags(modifierFlagsForEvent(event)).join('+')
  // `Tab` and `Shift+Tab` are reserved for keyboard navigation.
  const key =
    (
      DISALLOWED_KEYS.has(event.key) ||
      (!event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Tab')
    ) ?
      null
    : event.key === ' ' ? 'Space'
    : event.key === DELETE_KEY ? 'OsDelete'
    : (normalizedKeyboardSegmentLookup[event.key.toLowerCase()] ?? event.key)
  return { key, modifiers }
}

const { getText } = useText()
const open = ref(true)
const formComponent = ref<ComponentPublicInstance>()
const key = ref<string | null>(null)
const modifiers = ref('')

const shortcut = computed(() =>
  key.value == null ? modifiers.value
  : modifiers.value === '' ? key.value
  : `${modifiers.value}+${key.value}`,
)
const doesAlreadyExist = computed(() => key.value != null && existingShortcuts.has(shortcut.value))
const canSubmit = computed(() => key.value != null && !doesAlreadyExist.value)

function formElement() {
  const element: unknown = formComponent.value?.$el
  return element instanceof HTMLFormElement ? element : undefined
}

// After the dialog has moved focus onto itself: the form takes the keys.
onMounted(() => requestAnimationFrame(() => formElement()?.focus({ preventScroll: true })))

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && key.value === 'Escape') {
    // Ignore.
  } else if (event.key === 'Enter' && key.value != null) {
    formElement()?.requestSubmit()
  } else {
    event.preventDefault()
    event.stopPropagation()
    const newShortcut = eventToPartialShortcut(event)
    if (event.key === 'Tab' && newShortcut.key == null) {
      // Ignore.
    } else {
      key.value = newShortcut.key
      modifiers.value = newShortcut.modifiers
    }
  }
}

function onKeyUp(event: KeyboardEvent) {
  // A modifier may have been released.
  if (key.value == null) modifiers.value = eventToPartialShortcut(event).modifiers
}

function submit() {
  if (canSubmit.value) onSubmit(shortcut.value)
}
</script>

<template>
  <Dialog
    v-model:open="open"
    :aria-label="getText('enterTheNewKeyboardShortcutFor', description)"
    @closed="emit('close')"
  >
    <Form
      ref="formComponent"
      tabindex="-1"
      method="dialog"
      :schema="(z) => z.object({})"
      class="flex-col items-center"
      gap="none"
      @keydown="onKeyDown"
      @keyup="onKeyUp"
      @click.stop
      @submit="submit"
    >
      <div class="relative">{{ getText('enterTheNewKeyboardShortcutFor', description) }}</div>
      <div
        :class="
          twMerge(
            'relative flex scale-150 items-center justify-center',
            doesAlreadyExist && 'text-red-600',
          )
        "
      >
        <Text v-if="shortcut === ''">{{ getText('noShortcutEntered') }}</Text>
        <KeyboardShortcut v-else :shortcut="shortcut" />
      </div>
      <Text class="relative text-red-600">
        {{ doesAlreadyExist ? 'This shortcut already exists.' : '' }}
      </Text>
      <ButtonGroup>
        <Submit :isDisabled="!canSubmit">{{ getText('confirm') }}</Submit>
        <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
      </ButtonGroup>
    </Form>
  </Dialog>
</template>
