/** @file Timeouts the project service takes from the environment. */

/** The longest delay `setTimeout` honours; a longer one (or `Infinity`) fires after 1 ms. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

/**
 * A timeout in milliseconds from an environment variable's value: `fallback` when it is unset, not
 * a finite number, or not positive; otherwise the value, clamped to {@link MAX_TIMEOUT_MS} (Node's
 * `setTimeout` turns anything longer into 1 ms, which would kill an engine at once).
 */
export function timeoutFromEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, MAX_TIMEOUT_MS)
}
