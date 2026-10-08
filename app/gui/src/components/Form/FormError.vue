<script setup lang="ts">
/**
 * @file The form-level errors. It shows the offline notice (for a form that cannot submit
 * offline) and a failed submission's message, each in an `Alert`, with the test ids
 * `form-submit-offline` and `form-submit-error`.
 */
import Alert from '$/components/Alert/Alert.vue'
import type { ALERT_STYLES } from '$/components/Alert/variants'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'
import { FORM_OFFLINE_ERROR, FORM_SUBMIT_ERROR, formLevelErrors } from './errorMap'
import { useFormContext } from './formContext'
import type { AnyFormInstance } from './types'

type AlertVariants = VariantProps<typeof ALERT_STYLES>

const {
  form,
  size = 'large',
  variant = 'error',
  rounded = 'xxlarge',
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the variant default applies.
  fullWidth = undefined,
  class: className,
} = defineProps<{
  form?: AnyFormInstance | undefined
  size?: AlertVariants['size']
  variant?: AlertVariants['variant']
  rounded?: AlertVariants['rounded']
  fullWidth?: boolean | undefined
  class?: string | undefined
}>()

const formInstance = useFormContext(form)
const { getText } = useText()

const errors = computed(() =>
  formLevelErrors(
    getText,
    formInstance.formState.errors[FORM_OFFLINE_ERROR],
    formInstance.formState.errors[FORM_SUBMIT_ERROR],
  ),
)
</script>

<template>
  <div v-if="errors.length > 0" class="flex w-full flex-col gap-4">
    <Alert
      v-for="error in errors"
      :key="error.message"
      :size="size"
      :variant="error.type === 'offline' ? 'outline' : variant"
      :rounded="rounded"
      :fullWidth="fullWidth"
      :icon="error.type === 'offline' ? 'cloud_offline' : undefined"
      :class="className"
    >
      <Text
        disableLineHeightCompensation
        variant="body"
        truncate="3"
        color="primary"
        :testId="`form-submit-${error.type}`"
      >
        {{ error.message }}
      </Text>
    </Alert>
  </div>
</template>
