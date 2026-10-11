/**
 * @file `useForm`: the in-house form state over zod that `Form.vue` and the Vue inputs use, chosen
 * over vee-validate in decision 2 of `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 *
 * It provides:
 * - the schema is a zod object (or a callback building one), validated asynchronously with the
 *   shared i18n error map, so every message comes from a `useText()` key;
 * - fields are validated on submit, then re-validated on change (the default
 *   `mode: 'onSubmit'`, `reValidateMode: 'onChange'`); `mode` picks the others;
 * - dirty and touched state per field and for the form;
 * - `submit()` validates, focuses the first invalid field, and awaits `onSubmit` while
 *   `formState.isSubmitting` is set. A failure is reported to Sentry when it is a JS error, and
 *   shown as a form-level error (`FormError`); then `onSubmitFailed` runs. On success it closes the
 *   enclosing dialog for `method: 'dialog'`, resets the form (unless `resetOnSubmit: false`), and
 *   runs `onSubmitSuccess`. `onSubmitted` runs either way;
 * - offline, a form that cannot submit offline shows the offline notice and does not submit;
 * - `setFormError`, `setError`, `clearErrors`, `setValue`, `getValues`, `watch`, `trigger`,
 *   `reset`, `resetField`, `setFocus`, `getFieldState`.
 */
import { injectDialogContext } from '$/components/Dialog/dialogContext'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import * as sentry from '@sentry/vue'
import * as errorUtils from 'enso-common/src/utilities/errors'
import {
  computed,
  hasInjectionContext,
  nextTick,
  reactive,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
} from 'vue'
import { z } from 'zod'
import { FORM_OFFLINE_ERROR, FORM_SUBMIT_ERROR, makeFormErrorMap } from './errorMap'
import type {
  DefaultValues,
  FieldError,
  FieldRegistration,
  FieldState,
  FieldValues,
  FormInstance,
  FormState,
  TransformedValues,
  TSchema,
  UseFormOptions,
} from './types'
import { cloneValues, getPath, isPathWithin, leafPaths, setPath, valuesEqual } from './values'

/** Whether an error key is a form-level one (`root.*`), which validation leaves alone. */
const isRootError = (key: string) => isPathWithin(key, 'root')

/** Create a form. Call it in a component's `setup` (it uses the enclosing dialog, if any). */
export function useForm<Schema extends TSchema, SubmitResult = void>(
  options: UseFormOptions<Schema, SubmitResult>,
): FormInstance<Schema> {
  const {
    mode = 'onSubmit',
    reValidateMode = 'onChange',
    canSubmitOffline = false,
    method,
    resetOnSubmit = true,
    shouldFocusError = true,
    debugName,
  } = options
  const schema: Schema = typeof options.schema === 'function' ? options.schema(z) : options.schema

  const { getText } = useText()
  const errorMap = makeFormErrorMap(getText)
  const isOnline = useIsOnline()
  const dialog = hasInjectionContext() ? injectDialogContext(true) : undefined

  const readDefaults = () =>
    cloneValues((toValue(options.defaultValues) ?? {}) as FieldValues<Schema>)

  const defaults = shallowRef<FieldValues<Schema>>(readDefaults())
  const values = shallowRef<FieldValues<Schema>>(cloneValues(defaults.value))
  const errors = shallowRef<Record<string, FieldError>>({})
  const touched = shallowRef<ReadonlySet<string>>(new Set())
  const validating = ref(0)
  const isValid = ref(false)
  const state = reactive({
    isSubmitting: false,
    isSubmitted: false,
    isSubmitSuccessful: false,
    submitCount: 0,
  })
  /** Fields in registration (render) order, for focusing the first invalid one. */
  const registrations = new Map<string, FieldRegistration>()

  const dirtyFields: ComputedRef<ReadonlySet<string>> = computed(() => {
    const paths = new Set([...leafPaths(values.value), ...leafPaths(defaults.value)])
    return new Set(
      [...paths].filter(
        (path) => !valuesEqual(getPath(values.value, path), getPath(defaults.value, path)),
      ),
    )
  })

  const formState: FormState = readonly(
    reactive({
      isSubmitting: computed(() => state.isSubmitting),
      isSubmitted: computed(() => state.isSubmitted),
      isSubmitSuccessful: computed(() => state.isSubmitSuccessful),
      submitCount: computed(() => state.submitCount),
      isValidating: computed(() => validating.value > 0),
      isValid,
      isDirty: computed(() => dirtyFields.value.size > 0),
      errors,
      dirtyFields,
      touchedFields: touched,
    }),
  ) as FormState

  function setErrors(update: (current: Record<string, FieldError>) => Record<string, FieldError>) {
    errors.value = update({ ...errors.value })
  }

  /** Errors by field path, from a failed parse: the first issue of each path wins. */
  function issuesToErrors(error: z.ZodError): Record<string, FieldError> {
    const result: Record<string, FieldError> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.')
      result[key] ??= { message: issue.message, type: 'validation' }
    }
    return result
  }

  async function parse() {
    validating.value += 1
    try {
      return await schema.safeParseAsync(values.value, { errorMap })
    } finally {
      validating.value -= 1
    }
  }

  /**
   * Validate, and update the errors of the given fields (or of all fields). Resolves to whether
   * those fields (or the whole form) are valid, and to the parsed values when all are.
   */
  async function validate(names?: readonly string[]) {
    const result = await parse()
    const found = result.success ? {} : issuesToErrors(result.error)
    isValid.value = result.success
    setErrors((current) => {
      for (const key of Object.keys(current)) {
        if (isRootError(key)) continue
        if (names == null || names.some((name) => isPathWithin(key, name))) delete current[key]
      }
      for (const [key, error] of Object.entries(found)) {
        if (names == null || names.some((name) => isPathWithin(key, name))) current[key] = error
      }
      return current
    })
    const valid =
      names == null ?
        result.success
      : !Object.keys(found).some((key) => names.some((name) => isPathWithin(key, name)))
    return { valid, data: result.success ? result.data : undefined }
  }

  // `isValid` follows the values in the background, without showing any error.
  watch(
    values,
    async () => {
      const result = await parse()
      isValid.value = result.success
    },
    { immediate: true },
  )

  function shouldValidateOn(event: 'blur' | 'change', name: string) {
    if (state.submitCount > 0) {
      return reValidateMode === (event === 'change' ? 'onChange' : 'onBlur')
    }
    switch (mode) {
      case 'all':
        return true
      case 'onChange':
        return event === 'change'
      case 'onBlur':
        return event === 'blur'
      case 'onTouched':
        return event === 'blur' || touched.value.has(name)
      case 'onSubmit':
        return false
    }
  }

  function notifyChange(name: string, value: unknown) {
    options.onChange?.(name as never, value, form)
  }

  const getValues = ((name?: string) =>
    name == null ? values.value : getPath(values.value, name)) as FormInstance<Schema>['getValues']

  function setValue(
    name: string,
    value: unknown,
    setOptions: { shouldValidate?: boolean; shouldDirty?: boolean; shouldTouch?: boolean } = {},
  ) {
    values.value = setPath(values.value, name, value)
    if (setOptions.shouldDirty === false) {
      // Not dirty: the new value becomes the default.
      defaults.value = setPath(defaults.value, name, value)
    }
    if (setOptions.shouldTouch === true) {
      touched.value = new Set([...touched.value, name])
    }
    notifyChange(name, value)
    if (setOptions.shouldValidate === true) void validate([name])
  }

  function changeField(name: string, value: unknown) {
    values.value = setPath(values.value, name, value)
    notifyChange(name, value)
    if (shouldValidateOn('change', name)) void validate([name])
  }

  function blurField(name: string) {
    if (!touched.value.has(name)) touched.value = new Set([...touched.value, name])
    if (shouldValidateOn('blur', name)) void validate([name])
  }

  function getFieldState(name: string): FieldState {
    const error = errors.value[name]?.message
    return {
      error,
      invalid: error != null,
      hasError: error != null,
      isDirty: [...dirtyFields.value].some((path) => isPathWithin(path, name)),
      isTouched: touched.value.has(name),
      isValidating: validating.value > 0,
    }
  }

  function setError(name: string, error: { readonly message: string }) {
    setErrors((current) => ({ ...current, [name]: { message: error.message, type: 'manual' } }))
  }

  function clearErrors(name?: string | readonly string[]) {
    const names =
      name == null ? null
      : typeof name === 'string' ? [name]
      : name
    setErrors((current) => {
      for (const key of Object.keys(current)) {
        if (names == null || names.some((n) => isPathWithin(key, n))) delete current[key]
      }
      return current
    })
  }

  function setFormError(message: string) {
    setError(FORM_SUBMIT_ERROR, { message })
  }

  async function trigger(name?: string | readonly string[]) {
    const names =
      name == null ? undefined
      : typeof name === 'string' ? [name]
      : name
    return (await validate(names)).valid
  }

  const offlineBlocked = () => !isOnline.value && !canSubmitOffline

  function showOfflineState() {
    if (offlineBlocked()) {
      setError(FORM_OFFLINE_ERROR, { message: getText('unavailableOffline') })
    } else {
      clearErrors(FORM_OFFLINE_ERROR)
    }
  }
  watch(isOnline, showOfflineState, { immediate: true })

  function reset(newValues?: DefaultValues<FieldValues<Schema>>) {
    defaults.value =
      newValues != null ? cloneValues(newValues as FieldValues<Schema>) : readDefaults()
    values.value = cloneValues(defaults.value)
    errors.value = {}
    touched.value = new Set()
    Object.assign(state, {
      isSubmitted: false,
      isSubmitSuccessful: false,
      submitCount: 0,
    })
    showOfflineState()
  }

  function resetField(name: string) {
    values.value = setPath(values.value, name, cloneValues(getPath(defaults.value, name)))
    clearErrors(name)
    if (touched.value.has(name)) {
      touched.value = new Set([...touched.value].filter((path) => !isPathWithin(path, name)))
    }
  }

  function setFocus(name: string) {
    registrations.get(name)?.focus?.()
  }

  function registerField(name: string, registration: FieldRegistration) {
    registrations.set(name, registration)
    return () => {
      if (registrations.get(name) === registration) registrations.delete(name)
    }
  }

  function focusFirstError() {
    const invalid = Object.keys(errors.value)
    for (const [name, registration] of registrations) {
      if (invalid.some((key) => isPathWithin(key, name))) {
        registration.focus?.()
        return
      }
    }
  }

  async function submit(event?: Event | null) {
    event?.preventDefault()
    event?.stopPropagation()
    if (state.isSubmitting) return
    if (offlineBlocked()) {
      showOfflineState()
      return
    }
    state.isSubmitting = true
    clearErrors(FORM_SUBMIT_ERROR)
    let submitted: TransformedValues<Schema> | undefined
    try {
      const { valid, data } = await validate()
      if (!valid) {
        state.isSubmitSuccessful = false
        if (shouldFocusError) {
          // The inputs are disabled while submitting; focus once they are enabled again.
          state.isSubmitting = false
          await nextTick()
          focusFirstError()
        }
        return
      }
      submitted = data as TransformedValues<Schema>
      let result: SubmitResult
      try {
        result = (await options.onSubmit?.(submitted, form)) as SubmitResult
      } catch (error) {
        reportFailure(error, submitted)
        state.isSubmitSuccessful = false
        await options.onSubmitFailed?.(error, submitted, form)
        await options.onSubmitted?.(undefined, error, submitted, form)
        return
      }
      if (method === 'dialog') dialog?.close()
      if (resetOnSubmit) reset()
      state.isSubmitSuccessful = true
      await options.onSubmitSuccess?.(result, submitted, form)
      await options.onSubmitted?.(result, null, submitted, form)
    } finally {
      // Counted at the end, so that a form reset by a successful submission still re-validates
      // on change.
      state.submitCount += 1
      state.isSubmitting = false
      state.isSubmitted = true
    }
  }

  function reportFailure(error: unknown, submittedValues: unknown) {
    const isJSError = errorUtils.isJSError(error)
    if (isJSError) {
      sentry.captureException(error, {
        contexts: { form: { values: submittedValues as Record<string, unknown>, debugName } },
      })
    }
    const fallback = getText('arbitraryFormErrorMessage')
    setFormError(isJSError ? fallback : errorUtils.tryGetMessage(error, fallback))
  }

  const form: FormInstance<Schema> = {
    schema,
    formState,
    getValues,
    watch: getValues,
    setValue: setValue as FormInstance<Schema>['setValue'],
    getFieldState,
    setError,
    clearErrors,
    setFormError,
    trigger,
    reset,
    resetField: resetField as FormInstance<Schema>['resetField'],
    setFocus,
    submit,
    registerField,
    changeField,
    blurField,
  }
  return form
}
