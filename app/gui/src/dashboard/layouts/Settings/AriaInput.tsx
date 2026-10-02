/** @file A styled input for settings pages. */
import type { FieldPath, TSchema } from '#/components/Form'
import { Input, type InputProps } from '#/components/Inputs/Input'
import { Password } from '#/components/Inputs/Password'
import { SETTINGS_FIELD_STYLES } from '$/components/Form/variants'

/** Props for a {@link SettingsAriaInput}. */
export interface SettingsAriaInputProps<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, Constraint>,
  Constraint extends number | string = number | string,
> extends Omit<
  InputProps<Schema, TFieldName, Constraint>,
  'fieldVariants' | 'size' | 'variant' | 'variants'
> {}

/** A styled input for settings pages. */
export function SettingsAriaInput<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, number | string>,
>(props: SettingsAriaInputProps<Schema, TFieldName>) {
  return <Input fieldVariants={SETTINGS_FIELD_STYLES} {...props} />
}

/** A styled password input for settings pages. */
export function SettingsAriaInputPassword<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, string>,
>(props: SettingsAriaInputProps<Schema, TFieldName, string>) {
  return <Password fieldVariants={SETTINGS_FIELD_STYLES} {...props} />
}

/** A styled email input for settings pages. */
export function SettingsAriaInputEmail<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, string>,
>(props: SettingsAriaInputProps<Schema, TFieldName, string>) {
  return (
    <Input<Schema, TFieldName, string>
      fieldVariants={SETTINGS_FIELD_STYLES}
      type="email"
      {...props}
    />
  )
}
