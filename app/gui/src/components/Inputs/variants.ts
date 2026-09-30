/**
 * @file Tailwind variants of the inputs, shared by the React `#/components/Inputs` (and the React
 * `Checkbox`, `Radio` and `Switch`) and their Vue ports in this folder.
 *
 * A few classes use react-aria-only modifiers (`selected:`, `pressed:`, `outside-visible-range:`,
 * `disabled:` on non-native elements). The Vue ports add the equivalents keyed on Reka's
 * `data-*`/ARIA attributes from the `*_VUE_STATES` constants below, per decision 5 of the
 * React-to-Vue record.
 */
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { TEXT_STYLE } from '$/components/Text/variants'
import { makeRoundedStyles } from '$/utils/style/roundedStyles'
import { tv } from '$/utils/style/tailwindVariants'

export const INPUT_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    // All variants SHOULD use objects, otherwise extending from them with e.g. `{ base: '' }`
    // results in `readOnly: { true: 'cursor-default [object Object]' }` for example.
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    invalid: {
      // Specified in compoundVariants. Real classes depend on Variants
      true: '',
    },
    readOnly: {
      true: 'cursor-default',
      false: 'cursor-text',
    },
    size: {
      custom: '',
      small: { base: 'px-[11px] pb-0.5 pt-1', icon: 'size-3' },
      medium: { base: 'px-[11px] pb-[6.5px] pt-[8.5px]', icon: 'size-4' },
    },
    rounded: makeRoundedStyles('base'),
    variant: {
      custom: '',
      outline: {
        base: 'border-[0.5px] border-primary/20 outline-offset-2 focus-within:border-primary/50 focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary',
        textArea: 'border-transparent focus-within:border-transparent',
      },
    },
  },
  slots: {
    icon: 'flex-none',
    addonStart: 'mt-[-1px] flex flex-none items-center gap-1',
    addonEnd: 'mt-[-1px] flex flex-none items-center gap-1',
    content: 'flex items-center gap-2',
    inputContainer: TEXT_STYLE({
      className: 'relative flex max-h-32 min-h-6 w-full items-center overflow-clip',
      variant: 'body',
    }),
    selectorContainer: 'flex',
    description: 'pointer-events-none block select-none opacity-80',
    textArea: 'block h-auto max-h-full w-full resize-none bg-transparent',
    resizableSpan: TEXT_STYLE({
      className:
        'pointer-events-none invisible absolute block max-h-32 min-h-10 overflow-y-auto break-all',
      variant: 'body',
    }),
  },
  compoundVariants: [
    {
      invalid: true,
      variant: 'outline',
      class: 'border-danger focus-within:border-danger focus-within:outline-danger',
    },
    {
      readOnly: true,
      class: 'focus-within:outline-transparent',
    },
  ],
  defaultVariants: {
    size: 'medium',
    rounded: 'xlarge',
    variant: 'outline',
  },
})

/** Styles of the Dropdown. */
export const DROPDOWN_STYLES = tv({
  base: 'group relative flex w-max cursor-pointer flex-col items-start whitespace-nowrap rounded-input',
  variants: {
    isFocused: {
      true: {
        container: 'z-1',
        options: DIALOG_BACKGROUND({
          className: 'shadow-xl overflow-hidden rounded-input',
        }),
        optionsContainer: 'grid-rows-1fr',
        input: 'z-1',
      },
      false: {
        container: 'overflow-hidden',
        options: 'before:h-full',
        optionsContainer: 'grid-rows-0fr',
      },
    },
    isReadOnly: {
      true: {
        input: 'read-only',
      },
    },
    multiple: {
      true: {
        optionsItem: 'hover:font-semibold',
      },
    },
    rounded: makeRoundedStyles('options', (classes) => `before:${classes}`),
    size: {
      medium: {
        container: 'h-10',
        input: 'px-4 pb-[6.5px] pt-[8.5px] h-10',
        optionsItem: 'px-4',
        hiddenOption: 'px-4',
        icon: 'size-4',
      },
      small: {
        container: 'h-8',
        input: 'px-4 py-1',
        optionsItem: 'px-4',
        hiddenOption: 'px-4',
        icon: 'size-3',
      },
      custom: {},
    },
  },
  slots: {
    container: 'absolute inset-0 min-h-full w-full min-w-max pb-px',
    icon: '',
    options:
      'relative min-h-full before:absolute before:inset-0 before:h-full before:w-full before:rounded-input before:border-0.5 before:border-primary/20 before:transition-colors',
    optionsSpacing: 'padding relative h-full',
    optionsContainer: 'relative grid max-h-60 w-full overflow-auto transition-grid-template-rows',
    optionsList: 'overflow-auto',
    optionsItem:
      'flex min-h-6 items-center gap-2 rounded-input transition-colors focus:cursor-default focus:bg-frame focus:font-bold focus:focus-ring not-focus:hover:bg-hover-bg not-selected:hover:bg-hover-bg',
    input: 'group relative flex items-center gap-2 w-full',
    dropdownArrow: 'rotate-90 opacity-80 group-hover:opacity-100',
    inputDisplay: 'grow select-none',
    hiddenOptions: 'flex h-0 flex-col overflow-hidden',
    hiddenOption: 'flex gap-2 font-bold',
  },
  defaultVariants: {
    rounded: 'xlarge',
    size: 'medium',
  },
})

/** Styles of the ComboBox. */
export const COMBO_BOX_STYLES = tv({
  base: 'w-full',
  variants: {
    rounded: makeRoundedStyles('inputContainer'),
    size: {
      custom: '',
      small: { inputContainer: 'px-[11px] pb-0.5 pt-1' },
      medium: { inputContainer: 'px-[11px] pb-[6.5px] pt-[8.5px]' },
    },
  },
  slots: {
    inputContainer: 'flex items-center gap-2 px-1.5 rounded-full border-0.5 border-primary/20',
    input: 'grow',
    resetButton: '',
    popover: 'py-2 w-[calc(var(--trigger-width)_+_48px)]',
    listBox: 'text-primary text-xs',
    listBoxItem: 'cursor-pointer rounded-full hover:bg-hover-bg px-2',
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xlarge',
  },
})

/** Styles of the DatePicker. */
export const DATE_PICKER_STYLES = tv({
  base: '',
  variants: {
    rounded: makeRoundedStyles('inputContainer'),
    size: {
      custom: '',
      small: { inputContainer: 'px-[11px] pb-0.5 pt-1' },
      medium: { inputContainer: 'px-[11px] pb-[6.5px] pt-[8.5px]' },
    },
  },
  slots: {
    inputContainer: 'flex items-center gap-2 rounded-full border-0.5 border-primary/20',
    dateInput: 'flex justify-start grow order-2',
    dateSegment: 'rounded placeholder-shown:text-primary/30 focus:bg-primary/10 px-[0.5px]',
    calendarButton: 'order-1 rotate-90',
    resetButton: 'order-2',
    calendarPopover: '',
    calendarDialog: 'text-primary text-xs mx-2',
    calendarContainer: '',
    calendarHeader: 'flex items-center mb-2',
    calendarHeading: 'grow text-center',
    calendarGrid: '',
    calendarGridHeader: 'flex',
    calendarGridHeaderCell: '',
    calendarGridBody: '',
    calendarGridCell:
      'text-center px-1 rounded border border-transparent hover:bg-primary/10 outside-visible-range:text-primary/30 disabled:text-primary/30 selected:border-primary/40',
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xlarge',
  },
})

/** Styles of the TimeField. */
export const TIME_FIELD_STYLES = tv({
  base: '',
  variants: {
    size: {
      small: {
        inputGroup: 'h-6 px-2',
      },
      medium: {
        inputGroup: 'h-8 px-4',
      },
    },
  },
  slots: {
    inputGroup: 'flex items-center gap-2 rounded-full border-0.5 border-primary/20',
    dateInput: 'flex justify-center grow',
    dateSegment: 'rounded placeholder-shown:text-primary/30 focus:bg-primary/10 px-[0.5px]',
    resetButton: '',
    calendarPopover: '',
    calendarDialog: 'text-primary text-xs mx-2',
    calendarContainer: '',
    calendarHeader: 'flex items-center mb-2',
    calendarHeading: 'grow text-center',
    calendarGrid: '',
    calendarGridHeader: 'flex',
    calendarGridHeaderCell: '',
    calendarGridBody: '',
    calendarGridCell:
      'text-center px-1 rounded border border-transparent hover:bg-primary/10 outside-visible-range:text-primary/30 disabled:text-primary/30 selected:border-primary/40',
  },
  defaultVariants: {
    size: 'medium',
  },
})

/** Styles of the Selector. */
export const SELECTOR_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    readOnly: { true: 'cursor-default' },
    size: {
      medium: { base: '' },
      small: { base: '' },
    },
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    variant: {
      outline: {
        base: 'border-[0.5px] border-primary/20',
      },
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxlarge',
    variant: 'outline',
  },
  slots: {
    radioGroup: 'grid',
  },
})

/** Styles of the SelectorOption. */
export const SELECTOR_OPTION_STYLES = tv({
  base: 'flex flex-1 w-full cursor-pointer',
  variants: {
    rounded: {
      // specified in compoundSlots
      none: '',
      small: '',
      medium: '',
      large: '',
      xlarge: '',
      xxlarge: '',
      xxxlarge: '',
      full: '',
    },
    size: {
      medium: { base: 'min-h-[31px]', radio: 'px-[9px] py-[3.5px]' },
      small: { base: 'min-h-6', radio: 'px-[7px] py-[1.5px]' },
    },
    isHovered: {
      true: '',
      false: '',
    },
    isSelected: {
      // specified in compoundVariants
      true: 'bg-primary',
      false: '',
    },
    isFocusVisible: {
      // specified in compoundVariants
      true: {
        radio:
          'outline outline-2 outline-transparent outline-offset-[-6px] focus-visible:outline-primary focus-visible:outline-offset-[2px] transition-[outline-offset] duration-200',
      },
      false: '',
    },

    isPressed: {
      // specified in compoundVariants
      true: '',
      false: '',
    },

    variant: {
      // specified in compoundVariants
      outline: '',
    },
  },
  slots: {
    radio: TEXT_STYLE({
      className:
        'relative flex flex-1 w-full items-center justify-center transition-colors duration-200',
      variant: 'body',
    }),
    hover:
      'absolute inset-x-0 inset-y-0 transition-[background-color,transform] duration-200 isolate',
  },
  compoundSlots: [
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'none',
      class: 'rounded-none',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'small',
      class: 'rounded-sm',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'medium',
      class: 'rounded-md',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'large',
      class: 'rounded-lg',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xlarge',
      class: 'rounded-xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xxlarge',
      class: 'rounded-2xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xxxlarge',
      class: 'rounded-3xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'full',
      class: 'rounded-full',
    },
  ],
  compoundVariants: [
    {
      variant: 'outline',
      isSelected: true,
      class: { radio: TEXT_STYLE({ variant: 'body', color: 'invert' }) },
    },
    {
      variant: 'outline',
      isHovered: true,
      isSelected: false,
      class: { hover: 'bg-invert/50' },
    },
    {
      variant: 'outline',
      isPressed: true,
      class: { hover: 'bg-invert scale-x-[0.95] scale-y-[0.85]' },
    },
    {
      variant: 'outline',
      isSelected: false,
      class: { radio: TEXT_STYLE({ variant: 'body', color: 'primary' }) },
    },
    {
      size: 'small',
      class: { hover: 'inset-[2px]' },
    },
    {
      size: 'medium',
      class: { hover: 'inset-[3px]' },
    },
  ],
  defaultVariants: {
    size: 'medium',
    rounded: 'xxxlarge',
    variant: 'outline',
  },
})

/** Styles of the MultiSelector. */
export const MULTI_SELECTOR_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    readOnly: { true: 'cursor-default' },
    size: {
      medium: '',
    },
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    variant: {
      outline: 'border-[0.5px] border-primary/20',
      'separate-outline': { listBox: 'gap-2' },
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxlarge',
    variant: 'outline',
  },
  slots: {
    listBox: 'grid',
  },
})

/** Styles of the MultiSelectorOption. */
export const MULTI_SELECTOR_OPTION_STYLES = tv({
  base: TEXT_STYLE({
    className:
      'flex flex-1 items-center justify-center min-h-8 relative overflow-clip cursor-pointer transition-[background-color,color,outline-offset] duration-200',
    variant: 'body',
  }),
  variants: {
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    size: {
      medium: { base: 'px-[11px] pb-1.5 pt-2' },
      small: { base: 'px-[11px] pb-0.5 pt-1' },
    },
    color: {
      primary:
        'selected:bg-primary selected:text-white hover:bg-primary/5 pressed:bg-primary/10 outline outline-2 outline-transparent outline-offset-[-2px] focus-visible:outline-primary focus-visible:outline-offset-0',
    },
    variant: {
      default: '',
      outline: 'border-[0.5px] border-primary/20',
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxxlarge',
    color: 'primary',
    variant: 'default',
  },
})

/** Styles of the OTPInput. */
export const OTP_INPUT_STYLES = tv({
  base: 'group flex overflow-hidden p-1 w-[calc(100%+8px)] -m-1 flex-1',
  slots: {
    slotsContainer: 'flex items-center justify-center flex-1 w-full gap-1',
  },
})

/** Styles of the OTPInput slot. */
export const OTP_SLOT_STYLES = tv({
  base: [
    'flex-1 h-10 min-w-8 flex items-center justify-center',
    'border border-primary rounded-xl',
    'outline outline-1 outline-transparent -outline-offset-2',
    'transition-[outline-offset] duration-200',
  ],
  variants: {
    isActive: { true: 'relative outline-offset-0 outline-2 outline-primary' },
    isInvalid: { true: { base: 'border-danger', char: 'text-danger' } },
  },
  slots: {
    char: TEXT_STYLE({ variant: 'body', weight: 'bold', color: 'current' }),
    fakeCaret:
      'absolute pointer-events-none inset-0 flex items-center justify-center animate-caret-blink before:w-px before:h-5 before:bg-primary',
  },
  compoundVariants: [{ isActive: true, isInvalid: true, class: { base: 'outline-danger' } }],
})

/**
 * The Vue `MultiSelector` option's spelling of `MULTI_SELECTOR_OPTION_STYLES`'s `selected:` and
 * `pressed:`, for a Reka `ListboxItem` (`aria-selected`, native `:active`).
 */
export const MULTI_SELECTOR_OPTION_VUE_STATES =
  'aria-selected:bg-primary aria-selected:text-white active:bg-primary/10'

/**
 * The Vue `DatePicker` calendar cell's spelling of `DATE_PICKER_STYLES`'s
 * `outside-visible-range:`, `disabled:` and `selected:`, for Reka's `DatePickerCellTrigger`.
 */
export const CALENDAR_CELL_VUE_STATES =
  'data-[outside-view]:text-primary/30 data-[disabled]:text-primary/30 data-[unavailable]:text-primary/30 data-[selected]:border-primary/40'

/**
 * The Vue `Dropdown`'s spelling of `DROPDOWN_STYLES`'s `not-focus:` and `not-selected:`, which
 * only match react-aria elements. The options are Reka `ListboxItem`s, which take real focus, so
 * `focus:` itself works unchanged.
 */
export const DROPDOWN_OPTION_VUE_STATES =
  '[&:not(:focus)]:hover:bg-hover-bg [&[aria-selected=false]]:hover:bg-hover-bg'

/**
 * The date and time segments' spelling of react-aria's `placeholder-shown:`, for Reka's segments
 * (`data-placeholder`).
 */
export const DATE_SEGMENT_VUE_STATES = 'data-[placeholder]:text-primary/30'
