<script setup lang="ts">
/**
 * @file A time field bound to a form field holding an `@internationalized/date` time, styled by
 * `TIME_FIELD_STYLES`. A Reka `TimeField`: the time is typed segment by segment
 * (`role="spinbutton"`; digits fill a segment, ArrowUp/ArrowDown change it, ArrowLeft/ArrowRight
 * move between them). The `x` button clears it (not shown when `isRequired`, unless
 * `noResetButton` says otherwise).
 */
import Button from '$/components/Button/Button.vue'
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { DATE_SEGMENT_VUE_STATES, TIME_FIELD_STYLES } from '$/components/Inputs/dateVariants'
import { useText } from '$/providers/text'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Time } from '@internationalized/date'
import { TimeFieldInput, TimeFieldRoot } from 'reka-ui'
import { computed } from 'vue'
import type { SegmentPart } from './dateSegments'

type TimeFieldVariants = VariantProps<typeof TIME_FIELD_STYLES>

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    defaultValue?: Time | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    isInvalid?: boolean | undefined
    /** Hide the button that clears the value. Default: `isRequired`. */
    noResetButton?: boolean | undefined
    granularity?: 'hour' | 'minute' | 'second' | undefined
    /** Segments to leave out, as `{ second: false }`. */
    segments?: Partial<Record<SegmentPart, boolean>> | undefined
    size?: TimeFieldVariants['size']
    /** The accessible name, when there is no `label`. */
    ariaLabel?: string | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { isRequired: false, isInvalid: undefined, noResetButton: undefined, segments: () => ({}) },
)

const { getText } = useText()

const field = useField<Time | null | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const value = computed({
  get: () => field.value.value ?? null,
  set: (time: Time | null | undefined) => field.onChange(time ?? null),
})
const shownSegments = computed(() => props.segments ?? {})
const invalid = computed(() => props.isInvalid ?? field.isInvalid.value)
const showReset = computed(() => !(props.noResetButton ?? props.isRequired))
const styles = computed(() => TIME_FIELD_STYLES({ size: props.size }))
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isRequired="isRequired"
    :isInvalid="invalid"
    :fullWidth="true"
    :preventLabelFocus="true"
    :ids="field.ids"
    :testId="testId"
  >
    <div :class="styles.base({ className: props.class })" :data-invalid="invalid || undefined">
      <TimeFieldRoot
        v-slot="{ segments: fieldSegments }"
        v-model="value"
        v-bind="granularity != null ? { granularity } : {}"
        :disabled="field.isDisabled.value"
        :required="isRequired === true"
        :class="styles.inputGroup()"
        :aria-label="ariaLabel ?? label"
        :aria-invalid="invalid || undefined"
        :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
        @focusout="field.onBlur"
      >
        <div :class="styles.dateInput()">
          <template v-for="(segment, i) in fieldSegments" :key="i">
            <TimeFieldInput
              v-if="shownSegments[segment.part as SegmentPart] !== false"
              :part="segment.part"
              :class="`${styles.dateSegment()} ${DATE_SEGMENT_VUE_STATES}`"
            >
              {{ segment.value }}
            </TimeFieldInput>
          </template>
        </div>
        <Button
          v-if="showReset"
          variant="icon"
          icon="close"
          :aria-label="getText('reset')"
          :class="styles.resetButton()"
          @press="value = null"
        />
      </TimeFieldRoot>
    </div>
  </Field>
</template>
