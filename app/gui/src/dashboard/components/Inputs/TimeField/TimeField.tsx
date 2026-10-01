/** @file A date picker. */
import {
  TimeField as AriaTimeField,
  DateInput,
  DateSegment,
  Group,
  Label,
  TimeFieldStateContext,
  type TimeFieldProps as AriaTimeFieldProps,
  type TimeValue,
} from '#/components/aria'
import { Button } from '#/components/Button'
import {
  Form,
  type FieldComponentProps,
  type FieldPath,
  type FieldPropsExcept,
  type FieldStateProps,
  type FieldValues,
  type TSchema,
} from '#/components/Form'
import { Text } from '#/components/Text'
import { TIME_FIELD_STYLES } from '$/components/Inputs/dateVariants'
import { useText } from '$/providers/react'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { forwardRef, useContext, type ForwardedRef } from 'react'
import type { DateSegment as DateSegmentType } from 'react-stately'

/** Props for a {@link TimeField}. */
export interface TimeFieldProps<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, TimeValue>,
>
  extends
    Pick<AriaTimeFieldProps<TimeValue>, 'granularity'>,
    FieldStateProps<
      Omit<
        AriaTimeFieldProps<Extract<FieldValues<Schema>[TFieldName], TimeValue>>,
        'children' | 'className' | 'style'
      >,
      Schema,
      TFieldName,
      TimeValue
    >,
    FieldPropsExcept<AriaTimeFieldProps<TimeValue>>,
    Pick<FieldComponentProps<Schema>, 'className' | 'style'>,
    VariantProps<typeof TIME_FIELD_STYLES> {
  readonly noResetButton?: boolean
  readonly segments?: Partial<Record<DateSegmentType['type'], boolean>>
}

// This is a function, even though it does not contain function syntax.
// eslint-disable-next-line no-restricted-syntax
const useTimeValueField = Form.makeUseField<TimeValue>()

/** A date picker. */
export const TimeField = forwardRef(function TimeFieldImpl<
  Schema extends TSchema,
  TFieldName extends FieldPath<Schema, TimeValue>,
>(props: TimeFieldProps<Schema, TFieldName>, ref: ForwardedRef<HTMLDivElement>) {
  const {
    isRequired = false,
    noResetButton = isRequired,
    segments = {},
    name,
    isDisabled,
    form,
    defaultValue,
    label,
    className,
    size,
    variants = TIME_FIELD_STYLES,
    granularity,
    style,
    isInvalid,
    contextualHelp,
    ...rest
  } = props

  const { fieldState, formInstance } = useTimeValueField({
    name,
    isDisabled,
    form,
    defaultValue,
  })

  const styles = variants({ size })

  return (
    <Form.Field
      preventLabelFocus
      form={formInstance}
      name={name}
      fullWidth
      label={label}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      isRequired={isRequired}
      isInvalid={fieldState.invalid}
      aria-details={props['aria-details']}
      ref={ref}
      style={style}
      contextualHelp={contextualHelp}
    >
      <Form.Controller
        control={formInstance.control}
        name={name}
        render={(renderProps) => (
          <AriaTimeField
            {...rest}
            isInvalid={isInvalid ?? false}
            className={styles.base({ className })}
            {...(granularity != null ? { granularity } : {})}
            {...renderProps.field}
          >
            <Label />
            <Group className={styles.inputGroup()}>
              <DateInput className={styles.dateInput()}>
                {(segment) =>
                  segments[segment.type] === false ?
                    <></>
                  : <DateSegment segment={segment} className={styles.dateSegment()} />
                }
              </DateInput>
              {!noResetButton && <TimeFieldResetButton className={styles.resetButton()} />}
            </Group>
            {props.description != null && <Text slot="description" />}
          </AriaTimeField>
        )}
      />
    </Form.Field>
  )
})

/** Props for a {@link TimeFieldResetButton}. */
interface TimeFieldResetButtonProps {
  readonly className?: string
}

/** A reset button for a {@link TimeField}. */
function TimeFieldResetButton(props: TimeFieldResetButtonProps) {
  const { className } = props
  const state = useContext(TimeFieldStateContext)
  const { getText } = useText()

  return (
    <Button
      // Do not inherit default Button behavior from TimeField.
      slot={null}
      variant="icon"
      aria-label={getText('reset')}
      icon="close"
      className={className ?? ''}
      onPress={() => {
        state?.setValue(null)
      }}
    />
  )
}
