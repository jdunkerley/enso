<script setup lang="ts">
/**
 * @file The datalink editor: `JSONSchemaInput.vue` over the datalink schema
 * (`$/utils/datalinkSchema.json`), validated by its compiled validators.
 */
import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }
import { AJV } from '$/utils/datalinkValidator'
import { assert } from 'enso-common/src/utilities/errors'
import JSONSchemaInput from './JSONSchemaInput.vue'

const {
  value,
  readOnly = false,
  dropdownTitle,
} = defineProps<{
  value: unknown
  readOnly?: boolean | undefined
  dropdownTitle?: string | undefined
}>()

const emit = defineEmits<{ change: [value: unknown] }>()

const DEFS: Record<string, object> = SCHEMA.$defs

/**
 * Get a known schema's validator by its path.
 * @throws {Error} when there is no schema present at the given path.
 */
function getValidator(path: string) {
  return assert<(value: unknown) => boolean>(() => AJV.getSchema(path))
}
</script>

<template>
  <JSONSchemaInput
    :defs="DEFS"
    :schema="SCHEMA.$defs.DataLink"
    path="#/$defs/DataLink"
    :getValidator="getValidator"
    :value="value"
    :readOnly="readOnly"
    :dropdownTitle="dropdownTitle"
    :onChange="(newValue: unknown) => emit('change', newValue)"
  />
</template>
