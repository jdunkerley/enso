/**
 * @file Types of the Vue form layer (`useForm`, `Form.vue` and the inputs). They mirror the React
 * `#/components/Form` types, without react-hook-form.
 */
import type { Path } from '$/utils/objectPath'
import type { MaybeRefOrGetter } from 'vue'
import type { z } from 'zod'

/** A form's schema: a zod object, optionally refined or transformed (up to twice). */
export type TSchema<Shape extends z.AnyZodObject = z.AnyZodObject> =
  Shape | z.ZodEffects<Shape> | z.ZodEffects<z.ZodEffects<Shape>>

/** The zod module, handed to a schema callback so that a form need not import it. */
export type SchemaBuilder = typeof z

/** A callback that builds a schema. */
export type SchemaCallback<Schema extends TSchema = TSchema> = (z: SchemaBuilder) => Schema

/** The type of the form's values while editing: what the inputs hold. */
export type FieldValues<Schema extends TSchema> = z.input<Schema>

/** The type of the form's values once validated: what `onSubmit` receives. */
export type TransformedValues<Schema extends TSchema> = z.output<Schema>

/** A dotted path to a field (`email`, `address.city`, `tags.0`). */
export type FieldPath<Schema extends TSchema, Constraint = unknown> = Path<
  FieldValues<Schema>,
  Constraint
> &
  string

/** A deep partial of the form's values, for `defaultValues`. */
export type DefaultValues<T> =
  T extends readonly unknown[] ? T
  : T extends Record<string, unknown> ? { [K in keyof T]?: DefaultValues<T[K]> }
  : T

/** A validation error of one field, or of the whole form (`root.submit`, `root.offline`). */
export interface FieldError {
  readonly message: string
  /** `validation` for schema errors, `manual` for `setError`. */
  readonly type: 'manual' | 'validation'
}

/** When a field is validated. The same names, and meaning, as react-hook-form's `mode`. */
export type ValidationMode = 'all' | 'onBlur' | 'onChange' | 'onSubmit' | 'onTouched'

/** Callbacks around a submission. The same as the React form's. */
export interface OnSubmitCallbacks<Schema extends TSchema, SubmitResult = void> {
  readonly onSubmit?:
    | ((
        values: TransformedValues<Schema>,
        form: FormInstance<Schema>,
      ) => Promise<SubmitResult> | SubmitResult)
    | undefined
  readonly onSubmitFailed?:
    | ((
        error: unknown,
        values: TransformedValues<Schema>,
        form: FormInstance<Schema>,
      ) => Promise<void> | void)
    | undefined
  readonly onSubmitSuccess?:
    | ((
        data: SubmitResult,
        values: TransformedValues<Schema>,
        form: FormInstance<Schema>,
      ) => Promise<void> | void)
    | undefined
  readonly onSubmitted?:
    | ((
        data: SubmitResult | undefined,
        error: unknown,
        values: TransformedValues<Schema>,
        form: FormInstance<Schema>,
      ) => Promise<void> | void)
    | undefined
}

/** Options of `useForm`. */
export interface UseFormOptions<
  Schema extends TSchema,
  SubmitResult = void,
> extends OnSubmitCallbacks<Schema, SubmitResult> {
  readonly schema: Schema | SchemaCallback<Schema>
  /**
   * The initial values. A ref or getter is read when the form is created and again on every
   * `reset()`, so a form fed by a query can call `reset()` once the data arrives. It is not
   * re-applied on its own, as in React.
   */
  readonly defaultValues?: MaybeRefOrGetter<DefaultValues<FieldValues<Schema>> | undefined>
  /** When fields are validated before the first submission. Default `onSubmit`. */
  readonly mode?: ValidationMode | undefined
  /** When fields are re-validated after a submission. Default `onChange`. */
  readonly reValidateMode?: 'onBlur' | 'onChange' | 'onSubmit' | undefined
  /** Whether the form can be submitted offline. Default `false`. */
  readonly canSubmitOffline?: boolean | undefined
  /** `dialog`: a successful submission closes the enclosing `Dialog.vue` or `Popover.vue`. */
  readonly method?: 'dialog' | (NonNullable<unknown> & string) | undefined
  /** Reset to the default values after a successful submission. Default `true`. */
  readonly resetOnSubmit?: boolean | undefined
  /** Focus the first invalid field when a submission fails validation. Default `true`. */
  readonly shouldFocusError?: boolean | undefined
  /** Called whenever a field's value changes, through an input or `setValue`. */
  readonly onChange?:
    | (<Name extends FieldPath<Schema>>(
        name: Name,
        value: unknown,
        form: FormInstance<Schema>,
      ) => void)
    | undefined
  /** A name for the form in error reports. */
  readonly debugName?: string | undefined
}

/** Options of `setValue`. */
export interface SetValueOptions {
  readonly shouldValidate?: boolean | undefined
  readonly shouldDirty?: boolean | undefined
  readonly shouldTouch?: boolean | undefined
}

/** The state of one field. */
export interface FieldState {
  readonly error: string | undefined
  readonly invalid: boolean
  readonly hasError: boolean
  readonly isDirty: boolean
  readonly isTouched: boolean
  readonly isValidating: boolean
}

/** The state of the whole form. Reactive: read it in a `computed` or a template. */
export interface FormState {
  readonly isSubmitting: boolean
  readonly isSubmitted: boolean
  readonly isSubmitSuccessful: boolean
  readonly submitCount: number
  readonly isValidating: boolean
  /** Whether the current values pass the schema. Kept up to date in the background. */
  readonly isValid: boolean
  readonly isDirty: boolean
  /** Errors by field path, plus `root.submit` and `root.offline` for the form-level ones. */
  readonly errors: Readonly<Record<string, FieldError>>
  readonly dirtyFields: ReadonlySet<string>
  readonly touchedFields: ReadonlySet<string>
}

/** What a field registers, so that the form can focus it. */
export interface FieldRegistration {
  readonly focus?: (() => void) | undefined
}

/**
 * A form: its values, state and actions. The Vue counterpart of the React `FormInstance`
 * (`UseFormReturn`), with the same method names, so that ports stay mechanical.
 *
 * It is reactive: `formState`, `getValues`, `watch` and `getFieldState` read reactive state, so a
 * `computed` or a template that calls them updates.
 */
export interface FormInstance<Schema extends TSchema = TSchema> {
  readonly schema: Schema
  readonly formState: FormState
  /** The whole value object, or one field's value. */
  readonly getValues: {
    (): FieldValues<Schema>
    (name: FieldPath<Schema>): unknown
  }
  /** Reactive read of a field (or of all values). In Vue, wrap it in `computed` to watch it. */
  readonly watch: {
    (): FieldValues<Schema>
    (name: FieldPath<Schema>): unknown
  }
  readonly setValue: (name: FieldPath<Schema>, value: unknown, options?: SetValueOptions) => void
  readonly getFieldState: (name: string) => FieldState
  readonly setError: (name: string, error: { readonly message: string }) => void
  readonly clearErrors: (name?: string | readonly string[]) => void
  /** Show a form-level error, as a failed submission does. `FormError` displays it. */
  readonly setFormError: (message: string) => void
  /** Validate some fields, or all; resolves to whether they are valid. */
  readonly trigger: (name?: string | readonly string[]) => Promise<boolean>
  /** Reset the values (to the defaults, or to `values`), errors and submission state. */
  readonly reset: (values?: DefaultValues<FieldValues<Schema>>) => void
  /** Reset one field to its default value, and clear its error, dirty and touched state. */
  readonly resetField: (name: FieldPath<Schema>) => void
  /** Focus a registered field. */
  readonly setFocus: (name: string) => void
  /** Validate and submit. Resolves when done; a failure is reported, not thrown. */
  readonly submit: (event?: Event | null) => Promise<void>
  /**
   * Record that a field is rendered, so that it can be focused on an error. Returns the
   * function that unregisters it. `useField` calls this.
   */
  readonly registerField: (name: string, registration: FieldRegistration) => () => void
  /** Change a field from its input: sets the value and validates by the form's mode. */
  readonly changeField: (name: string, value: unknown) => void
  /** Mark a field as touched, from its input's blur, and validate by the form's mode. */
  readonly blurField: (name: string) => void
  /** Whether the schema marks the field required (a string with a minimum length). */
  readonly isFieldRequired: (name: string) => boolean
}

/** A form of any schema, for components that do not need to know its fields. */
export type AnyFormInstance = FormInstance<any>
