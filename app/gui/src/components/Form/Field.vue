<script setup lang="ts">
/**
 * @file A labelled form field: the Vue counterpart of the React `Form.Field`, styled by the same
 * `FIELD_STYLES`. The inputs render their control inside one; a custom control can too.
 *
 * It shows the label (with a `*` when required, and an optional contextual-help button), the
 * control in a `<label>` so that clicking the text focuses it (unless `preventLabelFocus`), a
 * description, and the field's error from the form. The default slot receives the field's state
 * (`isInvalid`, `isDirty`, `isTouched`, `isValidating`, `hasError`, `error`).
 *
 * The `ids` tie the control to the label, description and error: an input passes the ids from
 * its `useField` and sets `aria-describedby`/`aria-errormessage` on its control with them.
 * Attributes (`aria-label`, `aria-details`, …) go on the root, as in React.
 * @example
 * ```vue
 * <Field name="age" label="Age" :ids="field.ids">
 *   <input v-model="field.value.value" :aria-describedby="field.ids.errorId" />
 * </Field>
 * ```
 */
import ContextualHelp from '$/components/ContextualHelp/ContextualHelp.vue'
import { FIELD_STYLES } from '$/components/Form/variants'
import type { ExtractFunction } from '$/utils/style/tailwindVariants'
import { computed, useId } from 'vue'
import FieldError from './FieldError.vue'
import { useOptionalFormContext } from './formContext'
import type { AnyFormInstance } from './types'
import type { FieldIds } from './useField'

const {
  name,
  form,
  label,
  description,
  contextualHelp,
  error = undefined,
  isRequired = false,
  isInvalid = false,
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the variant default applies.
  fullWidth = undefined,
  isHidden = undefined,
  preventLabelFocus = false,
  variants = FIELD_STYLES,
  ids,
  testId,
  class: className,
} = defineProps<{
  name: string
  form?: AnyFormInstance | undefined
  label?: string | undefined
  description?: string | undefined
  contextualHelp?: string | undefined
  /** Overrides the field's error. `null` shows none. */
  error?: string | null | undefined
  isRequired?: boolean | undefined
  isInvalid?: boolean | undefined
  fullWidth?: boolean | undefined
  isHidden?: boolean | undefined
  preventLabelFocus?: boolean | undefined
  /** React's `variants`/`fieldVariants`: a `FIELD_STYLES` extension. */
  variants?: ExtractFunction<typeof FIELD_STYLES> | undefined
  ids?: FieldIds | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const formInstance = useOptionalFormContext(form)
const state = computed(() => formInstance?.getFieldState(name))
const invalid = computed(() => isInvalid || state.value?.hasError === true)
const hasError = computed(() => (error !== undefined ? error : state.value?.error) != null)

const ownId = useId()
const fieldIds = computed<FieldIds>(
  () =>
    ids ?? {
      labelId: `${ownId}-label`,
      descriptionId: `${ownId}-description`,
      errorId: `${ownId}-error`,
    },
)

const classes = computed(() => variants({ fullWidth, isInvalid: invalid.value, isHidden }))

function onLabelClick(event: MouseEvent) {
  if (preventLabelFocus) event.preventDefault()
}
</script>

<template>
  <div
    :class="classes.base({ className })"
    :data-testid="testId"
    :aria-invalid="invalid"
    :aria-labelledby="label != null || $slots.label ? fieldIds.labelId : undefined"
    :aria-describedby="
      description != null || $slots.description ? fieldIds.descriptionId : undefined
    "
    :aria-errormessage="hasError ? fieldIds.errorId : undefined"
    :aria-required="isRequired"
  >
    <label :class="classes.fieldContent()" @click.capture="onLabelClick">
      <div :class="classes.labelContainer()">
        <span v-if="label != null || $slots.label" :id="fieldIds.labelId" :class="classes.label()">
          <slot name="label">{{ label }}</slot>
          <span
            v-if="isRequired"
            aria-hidden="true"
            class="text-primary"
            data-testid="required-mark"
          >
            {{ ' *' }}
          </span>
        </span>

        <div :class="classes.contextualHelp()">
          <ContextualHelp v-if="contextualHelp != null || $slots.contextualHelp" placement="top">
            <slot name="contextualHelp">{{ contextualHelp }}</slot>
          </ContextualHelp>
        </div>
      </div>

      <div :class="classes.content()">
        <slot
          :isInvalid="invalid"
          :isDirty="state?.isDirty ?? false"
          :isTouched="state?.isTouched ?? false"
          :isValidating="state?.isValidating ?? false"
          :hasError="state?.hasError ?? false"
          :error="state?.error"
        />
      </div>
    </label>

    <span
      v-if="description != null || $slots.description"
      :id="fieldIds.descriptionId"
      :class="classes.description()"
      data-testid="description"
    >
      <slot name="description">{{ description }}</slot>
    </span>

    <FieldError :id="fieldIds.errorId" :error="error" :name="name" :form="formInstance" />
  </div>
</template>
