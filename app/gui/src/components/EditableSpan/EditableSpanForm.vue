<script setup lang="ts">
/**
 * @file The form an editable `EditableSpan.vue` turns into: the text in an input (focused after a
 * 100 ms delay), a tick to submit it (once changed) and a cross to cancel. Escape, or a press
 * outside the form (one that both starts and ends outside), cancels too. The value must be
 * non-empty after trimming, and pass `schema` when given; a failed check or submission shows its
 * message beside the field in the danger colour.
 */
import Button from '$/components/Button/Button.vue'
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { FORM_OFFLINE_ERROR, FORM_SUBMIT_ERROR, formLevelErrors } from '$/components/Form/errorMap'
import { provideForm } from '$/components/Form/formContext'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { twJoin } from '$/utils/style/tailwindMerge'
import { useElementSize, useEventListener } from '@vueuse/core'
import { computed, ref } from 'vue'
import type { z } from 'zod'

const {
  text,
  testId,
  schema,
  onSubmit,
  onCancel,
  class: className = '',
} = defineProps<{
  text: string
  testId?: string | undefined
  schema?: ((schema: z.ZodType<string>) => z.ZodType<string>) | undefined
  onSubmit: (value: string) => Promise<void>
  onCancel: () => void
  class?: string | undefined
}>()

const { getText } = useText()

const form = useForm({
  schema: (z) => {
    const baseValueSchema = z.string().min(1).trim()
    const baseSchema = z.object({ value: baseValueSchema })
    if (schema != null) return baseSchema.merge(z.object({ value: schema(baseValueSchema) }))
    return baseSchema
  },
  defaultValues: { value: text },
  onSubmit: ({ value }) => onSubmit(value),
})
provideForm(form)

const formElement = ref<HTMLFormElement>()

// A press that starts and ends outside the form cancels.
let pressStartedOutside = false
function isOutside(event: PointerEvent) {
  const target = event.target
  return formElement.value != null && target instanceof Node && !formElement.value.contains(target)
}
useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    pressStartedOutside = isOutside(event)
  },
  { capture: true },
)
useEventListener(
  document,
  'pointerup',
  (event: PointerEvent) => {
    if (pressStartedOutside && isOutside(event)) onCancel()
    pressStartedOutside = false
  },
  { capture: true },
)

const errorMessage = computed(() => {
  const fieldError = form.formState.errors['value']?.message
  if (fieldError != null) return fieldError
  const formErrors = formLevelErrors(
    getText,
    form.formState.errors[FORM_OFFLINE_ERROR],
    form.formState.errors[FORM_SUBMIT_ERROR],
  ).filter(({ type }) => type === 'error')
  return formErrors.length > 0 ? formErrors.map(({ message }) => message).join('\n') : null
})

const { width: formWidth, height: formHeight } = useElementSize(formElement, undefined, {
  box: 'border-box',
})

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    onCancel()
  }
  event.stopPropagation()
}
</script>

<script lang="ts">
/** How far the error outline reaches around the form. */
const OFFSET = 12
const CROSS_OFFSET = 30
const OUTLINE_WIDTH = CROSS_OFFSET + 10
</script>

<template>
  <form
    ref="formElement"
    class="relative flex grow gap-1.5"
    data-testid="editable-span-form"
    novalidate
    @submit="form.submit"
  >
    <div class="flex flex-1 flex-shrink-0 basis-full items-center">
      <Input
        name="value"
        variant="custom"
        size="custom"
        rounded="none"
        :testId="testId"
        :class="twJoin('flex-shrink-0 flex-grow basis-0', className)"
        type="text"
        autoFocus
        :aria-label="getText('editNameShortcut')"
        :error="null"
        @contextmenu.stop
        @dblclick.stop
        @keydown="onKeyDown"
      />
      <div
        v-if="errorMessage != null && formWidth > 0"
        class="pointer-events-none absolute"
        :style="{
          width: `${formWidth + OUTLINE_WIDTH}px`,
          height: `${formHeight + OFFSET}px`,
          transform: `translateX(-${CROSS_OFFSET}px)`,
        }"
      >
        <div
          class="pointer-events-none absolute h-full w-full rounded-4xl border-[2px] border-danger"
          data-testid="error-message-outline"
        />
        <div data-testid="error-message-container" class="absolute bottom-0 right-0 top-0 z-1">
          <div
            :class="
              DIALOG_BACKGROUND({
                className:
                  'pointer-events-auto flex h-full max-w-[512px] items-center rounded-3xl rounded-l-none bg-danger pl-1.5 pr-2.5',
              })
            "
            style="transform: translateX(100%)"
          >
            <Text testId="error-message-text" variant="body" truncate="1" color="invert">
              {{ errorMessage }}
            </Text>
            <div
              class="absolute bottom-0 left-0 aspect-square w-5 -translate-x-full [background:radial-gradient(circle_at_0%_0%,_transparent_70%,_var(--color-danger)_70%)]"
            />
            <div
              class="absolute left-0 top-0 aspect-square w-5 -translate-x-full [background:radial-gradient(circle_at_0%_100%,_transparent_70%,_var(--color-danger)_70%)]"
            />
          </div>
        </div>
      </div>
      <div class="ml-1 flex w-auto flex-none basis-0 items-center gap-1.5">
        <Button
          v-if="form.formState.isDirty"
          type="submit"
          size="medium"
          variant="icon"
          icon="check"
          :isLoading="form.formState.isSubmitting"
          :aria-label="getText('confirmEdit')"
          @click.stop
        />
        <Button
          size="medium"
          variant="icon"
          icon="close"
          :aria-label="getText('cancelEdit')"
          @click.stop
          @press="onCancel"
        />
      </div>
    </div>
  </form>
</template>
