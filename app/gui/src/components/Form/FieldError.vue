<script setup lang="ts">
/**
 * @file A field's error message: the Vue counterpart of the React `Form.FieldError`. It shows the
 * `error` prop when given, else the field's validation error, else nothing.
 */
import { FIELD_ERROR_STYLES } from '$/components/Form/variants'
import { computed } from 'vue'
import { useOptionalFormContext } from './formContext'
import type { AnyFormInstance } from './types'

const {
  name,
  form,
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the variant default applies.
  fullWidth = undefined,
  error = undefined,
  id,
  class: className,
} = defineProps<{
  name?: string | undefined
  form?: AnyFormInstance | undefined
  /** Overrides the field's error. `null` shows none. */
  error?: string | null | undefined
  id?: string | undefined
  fullWidth?: boolean | undefined
  class?: string | undefined
}>()

const formInstance = useOptionalFormContext(form)
const message = computed(() => {
  if (error !== undefined) return error
  return name != null ? formInstance?.getFieldState(name).error : undefined
})
</script>

<template>
  <span
    v-if="message != null"
    :id="id"
    data-testid="error"
    :class="FIELD_ERROR_STYLES({ className, fullWidth })"
    >{{ message }}</span
  >
</template>
