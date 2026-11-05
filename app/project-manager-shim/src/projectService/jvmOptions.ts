/**
 * @file The value of `ENSO_JVM_OPTIONS`, which the launcher adds to the JVM it starts
 * (`engine/runner/.../JvmOptions.java`, Note [JVM Options Of The Engine]): a value with a newline
 * is one option per line, so that an option may contain spaces; any other value is split on
 * whitespace.
 */

/** Split a value as the launcher does. */
export function splitJvmOptions(value: string): string[] {
  const parts = value.includes('\n') ? value.split(/\r?\n/) : value.trim().split(/\s+/)
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/**
 * `ENSO_JVM_OPTIONS` for `options` after an `inherited` value: one option per line (ruling 2 of the
 * plan). The inherited value is split as the launcher would split it, so a whitespace-separated
 * one keeps its meaning; a single option gets a trailing newline, so that a space in it is not
 * read as a separator.
 */
export function jvmOptionsValue(inherited: string | undefined, options: readonly string[]): string {
  const lines = [...splitJvmOptions(inherited ?? ''), ...options]
  return lines.length === 1 ? `${lines[0]}\n` : lines.join('\n')
}
