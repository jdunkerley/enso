/**
 * @file The form layer's framework-free rules, shared by the React `#/components/Form` and its Vue
 * port (`Form.vue`) while both exist: the i18n zod error map, and the text of the form-level
 * errors. Every message comes from a `useText()` key, so no form hard-codes a string.
 */
import type { GetText } from '$/providers/text'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import type { ZodErrorMap } from 'zod'

/** The zod error map every form validates with: each issue becomes a localized message. */
export function makeFormErrorMap(getText: GetText): ZodErrorMap {
  return (issue) => {
    if (IS_DEV_MODE) {
      console.error('(Development only) Form validation error:', issue)
    }
    switch (issue.code) {
      case 'too_small':
        if (issue.minimum === 1 && issue.type === 'string') {
          return { message: getText('arbitraryFieldRequired') }
        } else {
          return { message: getText('arbitraryFieldTooSmall', issue.minimum.toString()) }
        }
      case 'too_big':
        return { message: getText('arbitraryFieldTooLarge', issue.maximum.toString()) }
      case 'invalid_type':
        return { message: getText('arbitraryFieldInvalid') }
      case 'invalid_string':
        if (issue.validation === 'email') {
          return { message: getText('invalidEmailValidationError') }
        }
        return { message: getText('arbitraryFieldInvalid') }
      case 'invalid_literal':
      case 'invalid_enum_value':
      case 'invalid_union':
      case 'unrecognized_keys':
      case 'invalid_union_discriminator':
      case 'invalid_arguments':
      case 'invalid_return_type':
      case 'not_multiple_of':
      case 'custom':
      case 'invalid_intersection_types':
      case 'invalid_date':
      case 'not_finite':
      default:
        return { message: getText('arbitraryFieldInvalid') }
    }
  }
}

/** The key of the form-level error set when a submission fails (`setFormError`). */
export const FORM_SUBMIT_ERROR = 'root.submit'
/** The key of the form-level error set while offline, for a form that cannot submit offline. */
export const FORM_OFFLINE_ERROR = 'root.offline'

/** A form-level error, as `FormError` shows it. */
export interface FormLevelError {
  /** `offline` is the offline notice; `error` is a failed submission. */
  readonly type: 'error' | 'offline'
  readonly message: string
}

/**
 * The form-level errors to show, offline first, from the two root errors' messages. A submission
 * error without a message gets the generic text.
 */
export function formLevelErrors(
  getText: GetText,
  offline: { readonly message?: string | undefined } | null | undefined,
  submit: { readonly message?: string | undefined } | null | undefined,
): readonly FormLevelError[] {
  const result: FormLevelError[] = []
  if (offline?.message != null) {
    result.push({ type: 'offline', message: offline.message })
  }
  if (submit != null) {
    result.push({
      type: 'error',
      message:
        submit.message ?? getText('arbitraryErrorTitle') + '. ' + getText('arbitraryErrorSubtitle'),
    })
  }
  return result
}
