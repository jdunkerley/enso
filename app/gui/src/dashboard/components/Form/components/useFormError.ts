/**
 * @file
 *
 * Hook to get the error message from the form.
 */
import { formLevelErrors } from '$/components/Form/errorMap'
import { useText } from '$/providers/react'
import { useFormContext } from './FormProvider'
import type { FormInstance } from './types'

/**
 * Props for {@link useFormError}.
 */
export interface UseFormErrorProps {
  // We do not need to know the form fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly form?: FormInstance<any>
}

/**
 * Hook to get the error message from the form.
 */
export function useFormError(props: UseFormErrorProps) {
  const form = useFormContext(props.form)
  const { errors } = form.formState
  const { getText } = useText()

  return formLevelErrors(getText, errors.root?.offline, errors.root?.submit)
}
