/** @file Functions related to writing values to objects. */

/**
 * Write `value` to `object[key]`.
 * "Unsafe" as a warning at the call site: it mutates the object in place (`document`, `window`,
 * an object passed in), where callers otherwise treat such values as read-only.
 */
export function unsafeWriteValue<T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: T[K],
) {
  object[key] = value
}
