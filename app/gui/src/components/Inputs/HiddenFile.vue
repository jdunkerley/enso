<script setup lang="ts">
/**
 * @file A file input bound to a form field, with no visible field: the Vue counterpart of the
 * React `HiddenFile`. The field holds the chosen `File`; `autoSubmit` submits the form as soon as
 * one is chosen. Attributes go on the `<input>`; a caller opens it with `click()`.
 */
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { ref } from 'vue'

defineOptions({ inheritAttrs: false })

const {
  name,
  form,
  accept,
  autoSubmit = false,
} = defineProps<{
  name: string
  form?: AnyFormInstance | undefined
  accept?: string | undefined
  /** Submit the form as soon as a file is chosen. */
  autoSubmit?: boolean | undefined
}>()

const input = ref<HTMLInputElement>()
const field = useField<File | undefined>({ name: () => name, form: () => form })

function onChange(event: Event) {
  field.onChange((event.target as HTMLInputElement).files?.[0])
  if (autoSubmit) void field.form.submit()
}

defineExpose({ input, click: () => input.value?.click() })
</script>

<template>
  <input
    ref="input"
    v-bind="$attrs"
    type="file"
    class="w-0"
    :name="name"
    :accept="accept"
    @change="onChange"
  />
</template>
