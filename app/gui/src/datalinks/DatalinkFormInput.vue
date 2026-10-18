<script setup lang="ts">
/**
 * @file The datalink editor (`DatalinkInput.vue`) as a field of the enclosing form. A validation
 * error shows only in the editor (its invalid inputs and the schema's descriptions); there is no
 * separate field error.
 */
import { useField } from '$/components/Form/useField'
import { toRaw } from 'vue'
import DatalinkInput from './DatalinkInput.vue'

const props = defineProps<{
  name: string
  readOnly?: boolean | undefined
  dropdownTitle?: string | undefined
}>()

const field = useField<unknown>({ name: () => props.name })
</script>

<template>
  <DatalinkInput
    :value="toRaw(field.value.value) ?? null"
    :readOnly="readOnly ?? false"
    :dropdownTitle="dropdownTitle"
    @change="(value) => field.onChange(value)"
  />
</template>
