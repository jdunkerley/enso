/**
 * @file Tailwind variants of the date picker and the time field, shared by the React input and its Vue port.
 * See `variants.ts` for the `*_VUE_STATES` constants.
 */
import { makeRoundedStyles } from '$/utils/style/roundedStyles'
import { tv } from '$/utils/style/tailwindVariants'

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
/**
 * The Vue `DatePicker` calendar cell's spelling of `DATE_PICKER_STYLES`'s
 * `outside-visible-range:`, `disabled:` and `selected:`, for Reka's `DatePickerCellTrigger`.
 */
export const CALENDAR_CELL_VUE_STATES =
  'data-[outside-view]:text-primary/30 data-[disabled]:text-primary/30 data-[unavailable]:text-primary/30 data-[selected]:border-primary/40'
/**
 * The date and time segments' spelling of react-aria's `placeholder-shown:`, for Reka's segments
 * (`data-placeholder`).
 */
export const DATE_SEGMENT_VUE_STATES = 'data-[placeholder]:text-primary/30'
