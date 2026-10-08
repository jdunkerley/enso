/** @file Styles for a result (`Result.vue`). */
import { tv } from '$/utils/style/tailwindVariants'

export const RESULT_STYLES = tv({
  base: 'flex flex-col items-center justify-center max-w-full px-6 py-4 text-center h-[max-content]',
  variants: {
    centered: {
      true: 'm-auto',
      false: '',
      horizontal: 'mx-auto',
      vertical: 'my-auto',
      all: 'm-auto',
      none: '',
    },
  },
  slots: {
    statusIcon:
      'mb-2 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-opacity-25 p-1 text-green',
    icon: 'h-6 w-6 flex-none',
    title: '',
    subtitle: 'max-w-[750px]',
    content: 'mt-3 w-full',
  },
  defaultVariants: { centered: 'all' },
})

/** Possible statuses for a result. */
export type ResultStatus = 'error' | 'idle' | 'info' | 'loading' | 'pending' | 'success'

/** What each {@link ResultStatus} shows: a spinner, an "i", or an `icons.svg` icon, and its colours. */
export interface ResultStatusStyle {
  readonly icon: 'check' | 'close' | 'info' | 'loader'
  readonly colorClassName: string
  readonly bgClassName: string
}

export const RESULT_STATUS_STYLES: Readonly<Record<ResultStatus, ResultStatusStyle>> = {
  loading: { icon: 'loader', colorClassName: 'text-primary', bgClassName: 'bg-transparent' },
  info: { icon: 'info', colorClassName: 'text-primary', bgClassName: 'bg-primary/15' },
  error: { icon: 'close', colorClassName: 'text-red-500', bgClassName: 'bg-red-500' },
  success: { icon: 'check', colorClassName: 'text-green-500', bgClassName: 'bg-green' },
  // `pending` is the same as `loading`. Used for mutations.
  pending: { icon: 'loader', colorClassName: 'text-primary', bgClassName: 'bg-transparent' },
  // `idle` is the same as `info`. Used for mutations.
  idle: { icon: 'info', colorClassName: 'text-primary', bgClassName: 'bg-primary/30' },
}
