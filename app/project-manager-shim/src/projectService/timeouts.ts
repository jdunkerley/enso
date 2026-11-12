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

/** How long an engine has to start, and to exit when asked. */
export interface EngineTimeouts {
  readonly startupMs: number
  readonly terminateMs: number
}

/**
 * The spec's stage 1e table, JVM column (the native engine is gone). A JVM engine passes `/_health`
 * at ~10 s uncached on the CI Windows runner (a slow laptop is 3x that), and its shutdown runs
 * Akka's and the JIT's teardown.
 */
export const ENGINE_TIMEOUTS: EngineTimeouts = {
  startupMs: 120_000,
  terminateMs: 30_000,
}

/** {@link ENGINE_TIMEOUTS}, with the two environment variables applied. */
export function engineTimeouts(env: NodeJS.ProcessEnv = process.env): EngineTimeouts {
  return {
    startupMs: timeoutFromEnv(env.ENSO_ENGINE_STARTUP_TIMEOUT_MS, ENGINE_TIMEOUTS.startupMs),
    terminateMs: timeoutFromEnv(env.ENSO_ENGINE_TERMINATE_TIMEOUT_MS, ENGINE_TIMEOUTS.terminateMs),
  }
}
