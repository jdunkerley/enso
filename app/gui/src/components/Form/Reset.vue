<script setup lang="ts">
/**
 * @file A form's reset button. It resets the form to its default values (not the native reset,
 * which would clear the inputs), and is disabled while the form is submitting or unchanged. Every
 * other prop falls through to `Button.vue`.
 */
import Button from '$/components/Button/Button.vue'
import type { ButtonVariants } from '$/components/Button/variants'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import { useFormContext } from './formContext'
import type { AnyFormInstance } from './types'

const {
  variant = 'outline',
  size = 'medium',
  form,
  onPress,
} = defineProps<{
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  form?: AnyFormInstance | undefined
  onPress?: ((event: MouseEvent) => unknown) | undefined
}>()

const formInstance = useFormContext(form)
const { getText } = useText()

const disabled = computed(
  () => formInstance.formState.isSubmitting || !formInstance.formState.isDirty,
)

function press(event: MouseEvent) {
  formInstance.reset()
  return onPress?.(event)
}
</script>

<template>
  <Button :variant="variant" :size="size" :isDisabled="disabled" :onPress="press">
    <slot>{{ getText('reset') }}</slot>
  </Button>
</template>
