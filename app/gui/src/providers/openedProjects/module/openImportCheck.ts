/** @file Run a check once, when every value it needs is there, whatever order they arrive in. */
import { watch, type WatchStopHandle } from 'vue'

/**
 * Call `run` with the value of `get` the first time it is not `undefined`, then stop watching.
 * The module's root, the suggestion database and the declared types each arrive asynchronously
 * and in no fixed order, so the project-open import check waits for all of them this way.
 */
export function whenReadyOnce<T>(get: () => T | undefined, run: (value: T) => void) {
  // Declared first: with `immediate`, the callback runs before `watch` returns.
  let stop: WatchStopHandle | undefined
  let done = false
  // eslint-disable-next-line prefer-const
  stop = watch(
    get,
    (value) => {
      if (done || value === undefined) return
      done = true
      stop?.()
      run(value)
    },
    { immediate: true },
  )
  if (done) stop()
}
