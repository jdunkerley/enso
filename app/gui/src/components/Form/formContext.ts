/**
 * @file How `Form.vue` hands its form to the fields, buttons and error displays inside it: the Vue
 * counterpart of the React `FormProvider`/`useFormContext`.
 */
import { createContextStore } from '@/providers'
import type { AnyFormInstance, FormInstance, TSchema } from './types'

export const [provideForm, injectForm] = createContextStore('Form', (form: AnyFormInstance) => form)

/**
 * The given form, or else the enclosing `Form.vue`'s. As in React, a field, `Submit` or `FormError`
 * outside a form must be given one through its `form` prop.
 */
export function useFormContext<Schema extends TSchema = TSchema>(
  form?: FormInstance<Schema> | undefined,
): FormInstance<Schema> {
  if (form != null) return form
  const injected = injectForm(true)
  if (injected == null) {
    throw new Error('A form field was used outside of a `Form`, and was not given a `form`.')
  }
  return injected as FormInstance<Schema>
}

/** The given form, or the enclosing one, or `undefined` outside any form. */
export function useOptionalFormContext<Schema extends TSchema = TSchema>(
  form?: FormInstance<Schema> | undefined,
): FormInstance<Schema> | undefined {
  return form ?? (injectForm(true) as FormInstance<Schema> | undefined)
}
