/** @file The text of a failed language-server evaluation, as the `evaluate_expression` tool reports it. */

/** Turns whatever a language-server evaluation failed with into its message text. */
export function formatLsError(err: unknown): string {
  if (err == null) return 'unknown LS error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    // Raw `ResultError` instance (or anything with a string `.payload`).
    if ('payload' in err && typeof (err as { payload: unknown }).payload === 'string') {
      return (err as { payload: string }).payload
    }
    // Result-shaped wrapper `{ ok: false, error: ResultError(...) }` — defensive in case a
    // caller ever rejects with an `Err(...)` instead of resolving with one.
    if ('ok' in err && (err as { ok: unknown }).ok === false && 'error' in err) {
      return formatLsError((err as { error: unknown }).error)
    }
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/**
 * Turn the engine's "Cannot encode class X to byte array." failures (raised when the agent's
 * expression evaluates to a non-Text value) into a hint pointing at `.to_text` / `.to_json` /
 * `.catch_primitive`. Other messages pass through unchanged.
 */
export function translateEngineError(message: string): string {
  const match = /^Cannot encode class ([\w$.]+) to byte array\.?$/.exec(message)
  if (match == null) return message
  const className = match[1]!
  const friendlyType =
    className.endsWith('.DataflowError') ? 'a DataflowError'
    : className.endsWith('.PanicException') ? 'a Panic'
    : `a non-Text value of type \`${className}\``
  return (
    `Expression must evaluate to Text, but it evaluated to ${friendlyType}. ` +
    'Wrap with `.to_text`, `.to_display_text`, or `.to_json` to convert. ' +
    'For expressions that may fail, use ' +
    '`((<expr>).catch_primitive (e -> e.to_display_text))` so the result is still Text.'
  )
}
