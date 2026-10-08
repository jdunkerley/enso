/**
 * @file `useField`: connects an input to its form: registration, value and field state.
 */
import { computed, onScopeDispose, toValue, useId, type MaybeRefOrGetter } from 'vue'
import { useFormContext } from './formContext'
import type { AnyFormInstance } from './types'

/** Options of {@link useField}. */
export interface UseFieldOptions {
  /** The field's dotted path in the form's values. */
  readonly name: MaybeRefOrGetter<string>
  /** The form; by default, the enclosing `Form.vue`'s. */
  readonly form?: MaybeRefOrGetter<AnyFormInstance | undefined>
  /** Overrides the form's default value for this field, applied once when the field is created. */
  readonly defaultValue?: unknown
  readonly isDisabled?: MaybeRefOrGetter<boolean | undefined>
  /**
   * Whether the field is required: its `*` mark and the input's `required`. Not read from the
   * schema: a field shows as required only when told, as it did before the Vue port (#75).
   */
  readonly isRequired?: MaybeRefOrGetter<boolean | undefined>
  /** Overrides whether the field shows as invalid; by default, whether it has an error. */
  readonly isInvalid?: MaybeRefOrGetter<boolean | undefined>
  /** Focuses the field's input, so that a failed submission can focus the first invalid field. */
  readonly focus?: () => void
}

/** Ids that tie a field's input to its label, description and error, for `aria-*` wiring. */
export interface FieldIds {
  readonly labelId: string
  readonly descriptionId: string
  readonly errorId: string
}

/** A field connected to its form: its value, state, handlers and ids. */
export function useField<T = unknown>(options: UseFieldOptions) {
  const form = useFormContext(toValue(options.form))
  const name = computed(() => toValue(options.name))

  if (options.defaultValue !== undefined && form.getValues(name.value as never) === undefined) {
    form.setValue(name.value as never, options.defaultValue, { shouldDirty: false })
  }

  const unregister = form.registerField(name.value, { focus: () => options.focus?.() })
  onScopeDispose(unregister)

  const value = computed<T>({
    get: () => form.getValues(name.value as never) as T,
    set: (newValue) => form.changeField(name.value, newValue),
  })
  const state = computed(() => form.getFieldState(name.value))
  const error = computed(() => state.value.error)
  const isInvalid = computed(() => toValue(options.isInvalid) ?? state.value.invalid)
  /** Only the prop: inputs that are disabled while submitting add `isSubmitting` themselves. */
  const isDisabled = computed(() => toValue(options.isDisabled) ?? false)
  const isSubmitting = computed(() => form.formState.isSubmitting)
  const isRequired = computed(() => toValue(options.isRequired) ?? false)

  const id = useId()
  const ids: FieldIds = {
    labelId: `${id}-label`,
    descriptionId: `${id}-description`,
    errorId: `${id}-error`,
  }

  return {
    form,
    name,
    value,
    error,
    state,
    isInvalid,
    isDisabled,
    isSubmitting,
    isRequired,
    ids,
    /** Set the value from the input, validating by the form's mode. */
    onChange: (newValue: T) => form.changeField(name.value, newValue),
    /** Mark the field touched, validating by the form's mode. */
    onBlur: () => form.blurField(name.value),
  }
}

/** The result of {@link useField}. */
export type UseFieldReturn<T = unknown> = ReturnType<typeof useField<T>>
