<script setup lang="ts">
/**
 * @file The datalink editor: `JSONSchemaInput.vue` over the datalink schema
 * (`$/utils/datalinkSchema.json`), validated by its compiled validators.
 */
import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }
import { AJV } from '$/utils/datalinkValidator'
import type { TextId } from 'enso-common/src/text'
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
 * Schema members the local IDE cannot offer yet, with the note shown where one is left out.
 * `EnsoSecret`: there are no local secrets yet, so a secure value is plain text.
 * `EnsoFileDataLink`: its path is an Enso Cloud path (`enso://Users/…`).
 */
const UNAVAILABLE_SCHEMAS: ReadonlyMap<string, TextId | null> = new Map([
  ['#/$defs/EnsoSecret', 'datalinkSecretsUnavailable'],
  ['#/$defs/EnsoFileDataLink', null],
])

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
    :unavailable="UNAVAILABLE_SCHEMAS"
    :onChange="(newValue: unknown) => emit('change', newValue)"
  />
</template>
