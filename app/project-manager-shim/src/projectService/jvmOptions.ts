/**
 * @file The JVM options of a `--jvm` engine. The launcher (`engine/runner`'s `Main.launchJvm`)
 * starts the JVM with its fixed list ({@link LAUNCHER_JVM_OPTIONS}), the engine package's
 * `jvm.options` lines, then `ENSO_JVM_OPTIONS` (`JvmOptions.java`, Note [JVM Options Of The
 * Engine]): a value with a newline is one option per line, so that an option may contain spaces;
 * any other value is split on whitespace.
 */

/** The options the launcher gives the JVM it starts through JNI (`Main.launchJvm`). */
export const LAUNCHER_JVM_OPTIONS = [
  '--sun-misc-unsafe-memory-access=allow',
  '--enable-native-access=org.graalvm.truffle',
  '--add-opens=java.base/java.nio=ALL-UNNAMED',
] as const

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

/** Split an `ENSO_JVM_OPTIONS` value as the launcher does. */
export function splitJvmOptions(value: string): string[] {
  const parts = value.includes('\n') ? value.split(/\r?\n/) : value.split(/\s+/)
  return parts.map(cleanJvmOptionLine).filter((part) => part !== '')
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

/**
 * The arguments of a `java` that creates an AOT cache from a training run's configuration. It
 * mirrors the JVM the launcher starts (its fixed options, the package's `jvm.options` lines, then
 * `ENSO_JVM_OPTIONS`), since a cache must be created with the options it was trained with.
 */
export function aotCreateArguments(args: {
  config: string
  cache: string
  component: string
  /** The text of the package's `jvm.options`, if it has one. */
  optionsFile: string | undefined
  /** The value of `ENSO_JVM_OPTIONS`, without the training's own options. */
  jvmOptions: string
}): string[] {
  return [
    '-XX:AOTMode=create',
    `-XX:AOTConfiguration=${args.config}`,
    `-XX:AOTCache=${args.cache}`,
    ...LAUNCHER_JVM_OPTIONS,
    ...(args.optionsFile != null ? parseJvmOptionsFile(args.optionsFile) : []),
    ...splitJvmOptions(args.jvmOptions),
    `--module-path=${args.component}`,
    '-m',
    'org.enso.runner/org.enso.runner.Main',
  ]
}
