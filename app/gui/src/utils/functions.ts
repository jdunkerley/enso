/** @file A collection of generic utility functions. */
import { identity } from '@vueuse/core'

/** A stable reference to a function that does nothing. */
export const noop: (...args: any[]) => void = () => {}
export const noopPromise: (...args: any[]) => Promise<void> = () => Promise.resolve()

/** A stable reference to a function that returns its input. */
export { identity }
