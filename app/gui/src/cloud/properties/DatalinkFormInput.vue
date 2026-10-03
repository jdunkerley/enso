<script setup lang="ts">
/**
 * @file The datalink editor as a field of the enclosing form: the Vue counterpart of the React
 * `DatalinkFormInput`. The editor itself is still React (`reactDatalinkInput.ts`). As in React, a
 * validation error shows only in the editor (its invalid inputs and the schema's descriptions):
 * React's `FieldError` there had no field around it, so it rendered nothing.
 */
import { useField } from '$/components/Form/useField'
import { toRaw } from 'vue'
import { DatalinkInput } from './reactDatalinkInput'

const props = defineProps<{
  name: string
  readOnly?: boolean | undefined
  dropdownTitle?: string | undefined
}>()

const field = useField<NonNullable<unknown> | null>({ name: () => props.name })
</script>

<template>
  <DatalinkInput
    :value="toRaw(field.value.value) ?? null"
    :readOnly="readOnly ?? false"
    v-bind="dropdownTitle != null ? { dropdownTitle } : {}"
    :onChange="field.onChange"
  />
</template>
