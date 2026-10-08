<script setup lang="ts">
/**
 * @file A form's submit button: a `Button.vue` of `type="submit"` (variant `submit`, labelled
 * "Submit" by default) that shows its loader, and is disabled, while the form is submitting. Every
 * other prop falls through to `Button.vue`.
 *
 * - `name` and `value` set that field just before submitting (a form with two submit
 *   buttons that mean different things).
 * - `isDisabledWhenInvalid` also disables it while the values fail the schema. It is off by
 *   default: pressing Submit on an invalid form is what shows and focuses the errors.
 */
import Button from '$/components/Button/Button.vue'
import type { ButtonVariants } from '$/components/Button/variants'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import { useFormContext } from './formContext'
import type { AnyFormInstance } from './types'

const {
  variant = 'submit',
  size = 'medium',
  isLoading = false,
  isDisabled = undefined,
  isDisabledWhenInvalid = false,
  form,
  name,
  value,
  onPress,
} = defineProps<{
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  isLoading?: boolean | undefined
  isDisabled?: boolean | undefined
  isDisabledWhenInvalid?: boolean | undefined
  form?: AnyFormInstance | undefined
  name?: string | undefined
  value?: unknown
  onPress?: ((event: MouseEvent) => unknown) | undefined
}>()

const formInstance = useFormContext(form)
const { getText } = useText()

const loading = computed(() => isLoading || formInstance.formState.isSubmitting)
const disabled = computed(() => {
  if (isDisabled != null) return isDisabled
  if (isDisabledWhenInvalid && !formInstance.formState.isValid) return true
  // `undefined` lets the button's own loading state disable it.
  return undefined
})

function press(event: MouseEvent) {
  if (name != null && value != null) formInstance.setValue(name as never, value)
  return onPress?.(event)
}
</script>

<template>
  <Button
    type="submit"
    :variant="variant"
    :size="size"
    :isLoading="loading"
    :isDisabled="disabled"
    :onPress="press"
  >
    <slot>{{ getText('submit') }}</slot>
  </Button>
</template>
