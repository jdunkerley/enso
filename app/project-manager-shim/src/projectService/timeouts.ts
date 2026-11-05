/** @file Timeouts the project service takes from the environment. */
import type { EngineMode } from './engineMode.js'

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

/** How long an engine has to start, to exit when asked, and for its ydoc port to accept. */
export interface EngineTimeouts {
  readonly startupMs: number
  readonly terminateMs: number
  readonly ydocWaitMs: number
}

/**
 * The spec's stage 1e table. A JVM engine passes `/_health` at ~10 s uncached on the CI Windows
 * runner (a slow laptop is 3x that), its shutdown runs Akka's and the JIT's teardown, and until the
 * ydoc server leaves the engine its ydoc port came 5.3 s after `lsReady` on Windows.
 */
export const ENGINE_TIMEOUTS: Readonly<Record<EngineMode, EngineTimeouts>> = {
  native: { startupMs: 30_000, terminateMs: 10_000, ydocWaitMs: 5_000 },
  jvm: { startupMs: 120_000, terminateMs: 30_000, ydocWaitMs: 30_000 },
}

/** The column for `mode`; the two environment variables override both columns. */
export function engineTimeouts(
  mode: EngineMode,
  env: NodeJS.ProcessEnv = process.env,
): EngineTimeouts {
  const column = ENGINE_TIMEOUTS[mode]
  return {
    startupMs: timeoutFromEnv(env.ENSO_ENGINE_STARTUP_TIMEOUT_MS, column.startupMs),
    terminateMs: timeoutFromEnv(env.ENSO_ENGINE_TERMINATE_TIMEOUT_MS, column.terminateMs),
    ydocWaitMs: column.ydocWaitMs,
  }
}
