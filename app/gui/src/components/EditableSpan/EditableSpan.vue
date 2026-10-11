<script setup lang="ts">
/**
 * @file A text that turns into a one-field form to edit it, which the drive's name cells use to
 * rename an asset in place.
 *
 * While not `editable` it is a truncated `Text`. While editable it is `EditableSpanForm.vue`. The
 * text is the `text` prop.
 */
import Text from '$/components/Text/Text.vue'
import { twJoin } from '$/utils/style/tailwindMerge'
import type { z } from 'zod'
import EditableSpanForm from './EditableSpanForm.vue'

const {
  text,
  editable = false,
  testId,
  schema,
  onSubmit,
  onCancel,
  class: className = '',
} = defineProps<{
  text: string
  editable?: boolean | undefined
  testId?: string | undefined
  /** Additional checks of the value. */
  schema?: ((schema: z.ZodType<string>) => z.ZodType<string>) | undefined
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
  class?: string | undefined
}>()
</script>

<template>
  <Text v-if="!editable" :class="twJoin('min-w-0', className)" :testId="testId" truncate="1">
    {{ text }}
  </Text>
  <EditableSpanForm
    v-else
    :text="text"
    :testId="testId"
    :class="className"
    :schema="schema"
    :onSubmit="onSubmit"
    :onCancel="onCancel"
  />
</template>
