/** @file Helpers for the settings tests' DOM queries. */

/**
 * `value`, which a test needs to be there.
 * @throws {Error} when it is missing.
 */
export function required<T>(value: T | null | undefined, what = 'element'): T {
  if (value == null) throw new Error(`Missing ${what}.`)
  return value
}
