/**
 * @file The JVM options of an engine: the engine package's `jvm.options` (the fixed options and the
 * engine's tuning) and `ENSO_JVM_OPTIONS`, parsed as `JvmOptions.java` does (Note [JVM Options Of
 * The Engine]): a value with a newline is one option per line, so that an option may contain
 * spaces; any other value is split on whitespace. A fixture of tricky lines, shared with
 * `JvmOptionsTest`, checks both parsers (`engine/runner/src/test/resources/…/jvm-options-cases.json`).
 */

/** Trims a line and drops a leading UTF-8 byte order mark, which `trim` leaves. */
function cleanJvmOptionLine(line: string): string {
  const trimmed = line.trim()
  return trimmed.charCodeAt(0) === 0xfeff ? trimmed.slice(1).trim() : trimmed
}

/**
 * The lines of an engine package's `jvm.options` (beside `component/`): one option per line, `#`
 * comments and blank lines left out.
 */
export function parseJvmOptionsFile(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(cleanJvmOptionLine)
    .filter((line) => line !== '' && !line.startsWith('#'))
}

/** Split an `ENSO_JVM_OPTIONS` value as `JvmOptions.fromEnvironment` does. */
export function splitJvmOptions(value: string): string[] {
  const parts = value.includes('\n') ? value.split(/\r?\n/) : value.trim().split(/\s+/)
  return parts.map(cleanJvmOptionLine).filter((part) => part !== '')
}
