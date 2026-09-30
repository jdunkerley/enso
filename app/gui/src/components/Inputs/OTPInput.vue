<script setup lang="ts">
/**
 * @file A one-time-code input bound to a string form field: the Vue counterpart of the React
 * `OTPInput`, styled by the same `OTP_INPUT_STYLES` and `OTP_SLOT_STYLES`, on Reka's `PinInput`
 * instead of `input-otp`. One `<input>` per character (`autocomplete="one-time-code"`): typing
 * moves to the next, Backspace to the previous, arrow keys between them, and pasting a code fills
 * them all. Six or more characters are grouped in threes with a separator, as in React.
 *
 * When every character is filled it calls `onComplete` and, unless `submitOnComplete` is `false`,
 * submits the form.
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { OTP_INPUT_STYLES, OTP_SLOT_STYLES } from '$/components/Inputs/variants'
import Separator from '$/components/Separator/Separator.vue'
import { PinInputInput, PinInputRoot } from 'reka-ui'
import { computed, ref } from 'vue'
import { useAutoFocus } from './autoFocus'

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    maxLength: number
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    autoFocus?: boolean | undefined
    /** Submit the form once every character is filled. Default `true`. */
    submitOnComplete?: boolean | undefined
    onComplete?: (() => void) | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { submitOnComplete: true, autoFocus: false },
)

const root = ref<HTMLElement>()
const firstInput = computed(
  () => root.value?.querySelector<HTMLInputElement>('input:not([type="hidden"])') ?? undefined,
)

const field = useField<string | undefined>({
  name: () => props.name,
  form: () => props.form,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
  focus: () => firstInput.value?.focus(),
})

useAutoFocus(firstInput, () => props.autoFocus)

const characters = computed({
  get: () => [...(field.value.value ?? '')],
  set: (chars: string[]) => field.onChange(chars.join('')),
})
const activeIndex = ref<number | null>(null)

/** Slot indices, in sections of three when there are six or more. */
const sections = computed(() => {
  const indices = Array.from({ length: props.maxLength }, (_, i) => i)
  if (indices.length < 6) return [indices]
  const result: number[][] = []
  for (let i = 0; i < indices.length; i += 3) result.push(indices.slice(i, i + 3))
  return result
})

const classes = computed(() => OTP_INPUT_STYLES({ className: props.class }))

function slotClass(index: number) {
  const styles = OTP_SLOT_STYLES({
    isActive: activeIndex.value === index,
    isInvalid: field.isInvalid.value,
  })
  return `${styles.base()} ${styles.char()} text-center bg-transparent`
}

function handleComplete(chars: string[]) {
  props.onComplete?.()
  if (props.submitOnComplete) {
    field.form.setValue(field.name.value as never, chars.join(''), { shouldValidate: true })
    void field.form.submit()
  }
}
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :fullWidth="true"
    :ids="field.ids"
    :testId="testId"
  >
    <div ref="root" :class="classes.base()">
      <PinInputRoot
        v-model="characters"
        otp
        :name="name"
        :disabled="field.isDisabled.value || field.isSubmitting.value"
        :required="field.isRequired.value"
        role="presentation"
        class="flex w-full items-center gap-2"
        @complete="handleComplete"
      >
        <template v-for="(section, s) in sections" :key="s">
          <div :class="classes.slotsContainer()">
            <PinInputInput
              v-for="index in section"
              :key="index"
              :index="index"
              :class="slotClass(index)"
              :aria-invalid="field.isInvalid.value || undefined"
              :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
              @focus="activeIndex = index"
              @blur="((activeIndex = null), field.onBlur())"
            />
          </div>
          <Separator
            v-if="s < sections.length - 1"
            orientation="horizontal"
            class="w-3"
            size="medium"
          />
        </template>
      </PinInputRoot>
    </div>
  </Field>
</template>
