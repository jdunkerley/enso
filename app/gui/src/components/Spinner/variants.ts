/** @file Styles for the loader (`Loader.vue`). */
import { tv } from '$/utils/style/tailwindVariants'

export const LOADER_STYLES = tv({
  base: 'animate-appear-delayed flex h-full w-full items-center justify-center duration-200',
  variants: {
    minHeight: {
      full: 'h-full',
      h6: 'min-h-6',
      h8: 'min-h-8',
      h10: 'min-h-10',
      h12: 'min-h-12',
      h16: 'min-h-16',
      h20: 'min-h-20',
      h24: 'min-h-24',
      h32: 'min-h-32',
      h40: 'min-h-40',
      h48: 'min-h-48',
      h56: 'min-h-56',
      h64: 'min-h-64',
      screen: 'min-h-screen',
      custom: '',
    },
    height: {
      full: 'h-full',
      screen: 'h-screen',
      custom: '',
    },
    color: {
      primary: 'text-primary/50',
    },
  },
})

/** The state of the spinner. It should go from `initial`, to `loading`, to `done`. */
export type SpinnerPhase = 'done' | 'initial' | 'loading-fast' | 'loading-medium' | 'loading-slow'

/** The dash-array animation classes (custom Tailwind utilities) for each {@link SpinnerPhase}. */
export const SPINNER_PHASE_CLASSES: Readonly<Record<SpinnerPhase, string>> = {
  initial: 'dasharray-5 ease-linear',
  'loading-slow': 'dasharray-75 duration-spinner-slow ease-linear',
  'loading-medium': 'dasharray-75 duration-spinner-medium ease-linear',
  'loading-fast': 'dasharray-75 duration-spinner-fast ease-linear',
  done: 'dasharray-100 duration-spinner-fast ease-in',
}

/** The named sizes of a loader. */
export type LoaderSize = 'large' | 'medium' | 'small'

/** The spinner size, in pixels, for each {@link LoaderSize}. */
export const LOADER_SIZES: Readonly<Record<LoaderSize, number>> = {
  large: 64,
  medium: 32,
  small: 16,
}
