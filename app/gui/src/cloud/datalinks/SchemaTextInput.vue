<script setup lang="ts">
/**
 * @file A text or number input of the datalink editor, with its error under it: the
 * `<FocusRing><Input/></FocusRing>` and errors of the React `JSONSchemaInput`'s `string`, `number`
 * and `integer` cases, with the same classes.
 */
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useFocusRing } from './focusRing'
import { ROUNDED_INPUT_BASE_CLASSES, ROUNDED_INPUT_OUTLINE_CLASSES } from './variants'

const { type, readOnly, value, validationErrorClass, error } = defineProps<{
  type: 'integer' | 'number' | 'text'
  readOnly: boolean
  value: unknown
  validationErrorClass?: string | undefined
  /** The schema's description, shown while the value is invalid. */
  error?: string | undefined
}>()

const emit = defineEmits<{ change: [value: unknown] }>()

const { getText } = useText()
const focusRing = useFocusRing()

const placeholder = () =>
  type === 'text' ? getText('enterText')
  : type === 'number' ? getText('enterNumber')
  : getText('enterInteger')

function onInput(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (type === 'text') {
    emit('change', input.value)
  } else if (type === 'number') {
    if (Number.isFinite(input.valueAsNumber)) emit('change', input.valueAsNumber)
  } else {
    emit('change', Math.floor(input.valueAsNumber))
  }
}
</script>

<template>
  <div class="flex flex-col">
    <input
      :type="type === 'text' ? 'text' : 'number'"
      :readonly="readOnly"
      :value="
        type === 'text' ?
          typeof value === 'string' ?
            value
          : ''
        : typeof value === 'number' ? value
        : ''
      "
      :size="1"
      :class="
        twMerge(
          ROUNDED_INPUT_BASE_CLASSES,
          ROUNDED_INPUT_OUTLINE_CLASSES,
          'rounded-input',
          validationErrorClass,
          focusRing.isFocusVisible.value && 'focus-ring',
        )
      "
      :placeholder="placeholder()"
      @input="onInput"
      @focus="focusRing.onFocus"
      @blur="focusRing.onBlur"
    />
    <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
  </div>
</template>
