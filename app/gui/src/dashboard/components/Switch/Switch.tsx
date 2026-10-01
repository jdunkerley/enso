/** @file A switch allows a user to turn a setting on or off. */
import { forwardRef, useRef, type CSSProperties, type ForwardedRef } from 'react'

import {
  Switch as AriaSwitch,
  mergeProps,
  type SwitchProps as AriaSwitchProps,
} from '#/components/aria'
import { mergeRefs } from '#/utilities/mergeRefs'
import { SWITCH_STYLES } from '$/components/Switch/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { Form, type FieldPath, type FieldProps, type FieldStateProps, type TSchema } from '../Form'

/** Props for a {@link Switch}. */
export interface SwitchProps<Schema extends TSchema, TFieldName extends FieldPath<Schema, boolean>>
  extends
    FieldStateProps<
      Omit<AriaSwitchProps, 'children' | 'size' | 'value'> & { value: boolean },
      Schema,
      TFieldName,
      boolean
    >,
    FieldProps,
    Omit<VariantProps<typeof SWITCH_STYLES>, 'disabled' | 'invalid'> {
  readonly className?: string
  readonly style?: CSSProperties
  readonly labelPosition?: 'after' | 'before' | undefined
  readonly halfway?: boolean | undefined
}

// This is a function, even though it does not contain function syntax.
// eslint-disable-next-line no-restricted-syntax
const useBooleanField = Form.makeUseField<boolean>()

/** A switch allows a user to turn a setting on or off. */
export const Switch = forwardRef(function SwitchImpl<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, boolean>,
>(props: SwitchProps<Schema, TFieldName>, ref: ForwardedRef<HTMLDivElement>) {
  const {
    label,
    isDisabled = false,
    isRequired = false,
    halfway = false,
    defaultValue,
    className,
    name,
    form,
    description,
    error,
    size,
    labelPosition = 'after',
    contextualHelp,
    ...ariaSwitchProps
  } = props

  const switchRef = useRef<HTMLInputElement>(null)

  const { fieldState, formInstance, field } = useBooleanField({
    name,
    isDisabled,
    form,
    defaultValue,
  })

  const { ref: fieldRef, ...fieldProps } = formInstance.register(name, {
    disabled: isDisabled,
    required: isRequired,
    ...(props.onBlur && { onBlur: props.onBlur }),
    ...(props.onChange && {
      onChange: (event: { target: { value: boolean } }) => props.onChange?.(event.target.value),
    }),
  })

  const styles = SWITCH_STYLES({ size, disabled: fieldProps.disabled, halfway })

  return (
    <Form.Field
      ref={ref}
      form={formInstance}
      name={name}
      className={styles.base({ className })}
      fullWidth
      description={description}
      error={error}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      isRequired={fieldProps.required}
      isInvalid={fieldState.invalid}
      aria-details={props['aria-details']}
      style={props.style}
      contextualHelp={contextualHelp}
    >
      <AriaSwitch
        ref={(el) => {
          mergeRefs(switchRef, fieldRef)(el)
        }}
        {...mergeProps<AriaSwitchProps>()(ariaSwitchProps, fieldProps, {
          defaultSelected: field.value,
          className: styles.switch(),
          onChange: field.onChange,
          onBlur: field.onBlur,
        })}
      >
        {labelPosition === 'before' && <div className={styles.label()}>{label}</div>}

        <div className={styles.background()} role="presentation">
          <span className={styles.thumb()} />
        </div>

        {labelPosition === 'after' && <div className={styles.label()}>{label}</div>}
      </AriaSwitch>
    </Form.Field>
  )
})
