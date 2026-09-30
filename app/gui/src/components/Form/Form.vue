<script setup lang="ts" generic="Schema extends TSchema, SubmitResult = void">
/**
 * @file A form: the Vue counterpart of the React `#/components/Form`, styled by the same
 * `FORM_STYLES`. It creates a form with `useForm` (or takes one through `form`), provides it to the
 * fields inside, and submits it on the native submit event (`novalidate`: the schema validates).
 *
 * The props keep the React names: `schema`, `defaultValues`, `onSubmit` (bound with `@submit`),
 * `onSubmitSuccess`, `onSubmitFailed`, `onSubmitted`, `onChange`, `method="dialog"` (a successful
 * submission closes the enclosing dialog), `canSubmitOffline`, `gap`, `testId`, and `formOptions`
 * for the rest of `useForm`'s options. The default slot receives `{ form }`, React's render-prop
 * argument; `defineExpose` exposes it too (React's `formRef`).
 * @example
 * With `Form`, `Input`, `Submit` and `FormError` imported from `$/components/Form/` and
 * `$/components/Inputs/`, and `getText` from `useText()`:
 * ```vue
 * <Form
 *   :schema="(z) => z.object({ email: z.string().email() })"
 *   :defaultValues="{ email: '' }"
 *   @submit="({ email }) => forgotPassword(email)"
 * >
 *   <Input name="email" type="email" :label="getText('emailLabel')" icon="at" autoFocus />
 *   <Submit size="large" fullWidth>{{ getText('sendLink') }}</Submit>
 *   <FormError />
 * </Form>
 * ```
 */
import { FORM_STYLES, type FormStyleProps } from '$/components/Form/variants'
import { useId } from 'vue'
import { provideForm } from './formContext'
import type {
  DefaultValues,
  FieldValues,
  FormInstance,
  OnSubmitCallbacks,
  SchemaCallback,
  TSchema,
  UseFormOptions,
} from './types'
import { useForm } from './useForm'

type Props = OnSubmitCallbacks<Schema, SubmitResult> & {
  /** The schema, or a callback building it from zod. Required unless `form` is given. */
  schema?: Schema | SchemaCallback<Schema> | undefined
  defaultValues?: DefaultValues<FieldValues<Schema>> | (() => DefaultValues<FieldValues<Schema>>)
  /** A form created with `useForm` elsewhere, instead of creating one here. */
  form?: FormInstance<Schema> | undefined
  formOptions?:
    | Pick<
        UseFormOptions<Schema, SubmitResult>,
        'debugName' | 'mode' | 'resetOnSubmit' | 'reValidateMode' | 'shouldFocusError'
      >
    | undefined
  onChange?: UseFormOptions<Schema, SubmitResult>['onChange']
  /** `dialog`: a successful submission closes the enclosing dialog. */
  method?: 'dialog' | (NonNullable<unknown> & string) | undefined
  canSubmitOffline?: boolean | undefined
  gap?: FormStyleProps['gap']
  id?: string | undefined
  testId?: string | undefined
  class?: string | undefined
}

const props = defineProps<Props>()

defineSlots<{ default?: (props: { form: FormInstance<Schema> }) => unknown }>()

const ownId = useId()

function createForm(): FormInstance<Schema> {
  if (props.form != null) return props.form
  if (props.schema == null) throw new Error('A `Form` needs a `schema` or a `form`.')
  // The callbacks read the props when called, so that a parent's new handler is used.
  return useForm<Schema, SubmitResult>({
    ...props.formOptions,
    schema: props.schema,
    defaultValues: props.defaultValues as UseFormOptions<Schema>['defaultValues'],
    method: props.method,
    canSubmitOffline: props.canSubmitOffline ?? false,
    debugName: props.formOptions?.debugName ?? `Form ${props.testId} id: ${props.id ?? ownId}`,
    onSubmit: (...args) => props.onSubmit?.(...args) as SubmitResult,
    onSubmitSuccess: (...args) => props.onSubmitSuccess?.(...args),
    onSubmitFailed: (...args) => props.onSubmitFailed?.(...args),
    onSubmitted: (...args) => props.onSubmitted?.(...args),
    onChange: (...args) => props.onChange?.(...args),
  })
}

const formInstance = createForm()
provideForm(formInstance)

defineExpose({ form: formInstance })
</script>

<template>
  <form
    :id="id ?? ownId"
    :class="FORM_STYLES({ className: props.class, gap })"
    novalidate
    :data-testid="testId"
    @submit="formInstance.submit"
  >
    <slot :form="formInstance" />
  </form>
</template>
