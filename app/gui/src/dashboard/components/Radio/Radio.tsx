/** @file A radio button. */
import * as aria from '#/components/aria'
import { mergeRefs } from '#/utilities/mergeRefs'
import { RADIO_STYLES } from '$/components/Radio/variants'
import * as React from 'react'
import invariant from 'tiny-invariant'
import * as text from '../Text'
import { RadioGroup } from './RadioGroup'
import { useRadioGroupContext } from './RadioGroupContext'

/** Props for the {@link Radio} component. */
export interface RadioProps extends aria.RadioProps {
  readonly label?: string
}

/** A radio button. */
export const Radio = Object.assign(
  React.forwardRef(function RadioImpl(
    props: RadioProps,
    ref: React.ForwardedRef<HTMLLabelElement>,
  ) {
    const { children, label, className, ...ariaProps } = props

    const inputRef = React.useRef<HTMLInputElement>(null)
    const labelRef = React.useRef<HTMLLabelElement>(null)
    const id = aria.useId(ariaProps.id)

    const state = React.useContext(aria.RadioGroupStateContext)
    const { setPressed, clearPressed, isSiblingPressed } = useRadioGroupContext({
      value: props.value,
    })

    invariant(state, '<Radio /> must be used within a <RadioGroup />')

    const { isSelected, isDisabled, isPressed, inputProps, labelProps } = aria.useRadio(
      aria.mergeProps<aria.RadioProps>()(ariaProps, {
        id,
        children: label ?? (typeof children === 'function' ? true : children),
      }),
      state,
      inputRef,
    )

    const { isFocused, isFocusVisible, focusProps } = aria.useFocusRing()
    const interactionDisabled = isDisabled || state.isReadOnly
    const { hoverProps, isHovered } = aria.useHover({
      ...props,
      isDisabled: interactionDisabled,
    })

    React.useEffect(() => {
      if (isPressed) {
        setPressed()
      } else {
        clearPressed()
      }
    }, [isPressed, setPressed, clearPressed])

    const renderValues = {
      isSelected,
      isPressed,
      isHovered,
      isFocused,
      isFocusVisible,
      isDisabled,
      isReadOnly: state.isReadOnly,
      isInvalid: state.isInvalid,
      isRequired: state.isRequired,
      defaultChildren: null,
      defaultClassName: '',
    }

    const {
      base,
      radio,
      input,
      label: labelClasses,
    } = RADIO_STYLES({
      isSiblingPressed,
      isFocused,
      isFocusVisible,
      isHovered,
      isSelected,
      isInvalid: state.isInvalid,
      isDisabled,
      isPressed,
      className: typeof className === 'function' ? className(renderValues) : className,
    })

    const renderedChildren = typeof children === 'function' ? children(renderValues) : children

    return (
      <label
        {...aria.mergeProps<React.LabelHTMLAttributes<HTMLLabelElement>>()(hoverProps, labelProps)}
        ref={(el) => {
          mergeRefs(labelRef, ref)(el)
        }}
        className={base()}
      >
        <input
          {...aria.mergeProps<React.InputHTMLAttributes<HTMLInputElement>>()(
            inputProps,
            focusProps,
          )}
          ref={inputRef}
          id={id}
          className={input()}
        />

        <div className={radio()} />

        <text.Text className={labelClasses()} variant="body" truncate="1">
          {label ?? renderedChildren}
        </text.Text>
      </label>
    )
  }),
  /* eslint-disable @typescript-eslint/naming-convention */
  {
    Group: RadioGroup,
  },
  /* eslint-enable @typescript-eslint/naming-convention */
)
