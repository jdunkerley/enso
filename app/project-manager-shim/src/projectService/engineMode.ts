/** @file Which engine an opened or run project gets: the native image or GraalVM's JDK (spec "How the engine mode is chosen"). */
import { readPackageJvmMode } from '../localMetadata/packageYaml.js'

export type EngineMode = 'native' | 'jvm'
export type EngineModeSource = 'package.yaml' | 'option' | 'environment' | 'default'

export interface ResolvedEngineMode {
  readonly mode: EngineMode
  readonly source: EngineModeSource
}

export interface EngineModeSettings {
  /** Electron's `--engine-mode` (or `--jvm`). */
  readonly option?: EngineMode | undefined
  /** The raw value of `ENSO_ENGINE_MODE`. */
  readonly environment?: string | undefined
  /** The built-in default; {@link DEFAULT_ENGINE_MODE} when omitted. */
  readonly defaultMode?: EngineMode
}

/** The built-in default, `jvm` since the switch (stage 3). */
export const DEFAULT_ENGINE_MODE: EngineMode = 'jvm'

/** `native` or `jvm`, case and surrounding space ignored; anything else is `undefined`. */
export function parseEngineMode(raw: string | undefined): EngineMode | undefined {
  const value = raw?.trim().toLowerCase()
  return value === 'native' || value === 'jvm' ? value : undefined
}

/** The mode without the project's own `jvm:` key: the AOT cache trains for this one. */
export function resolveDefaultEngineMode(settings: EngineModeSettings): ResolvedEngineMode {
  if (settings.option) return { mode: settings.option, source: 'option' }
  const fromEnvironment = parseEngineMode(settings.environment)
  if (fromEnvironment) return { mode: fromEnvironment, source: 'environment' }
  return { mode: settings.defaultMode ?? DEFAULT_ENGINE_MODE, source: 'default' }
}

/** The mode for `projectPath`; the first match wins: package.yaml, option, environment, default. */
export async function resolveEngineMode(
  projectPath: string,
  settings: EngineModeSettings,
): Promise<ResolvedEngineMode> {
  const jvm = await readPackageJvmMode(projectPath)
  if (jvm != null) return { mode: jvm ? 'jvm' : 'native', source: 'package.yaml' }
  return resolveDefaultEngineMode(settings)
}

/**
 * `ENSO_ENGINE_ARGS` is a developer back door that used to be the only way to ask for a JVM engine
 * (the open-time harness does). A `--jvm` in it is lifted out into the `jvm` option, so the
 * resolver, the log line and the JVM timeouts see it, and `--jvm` is not passed twice.
 */
export function liftJvmFlag(
  args: readonly string[],
  option: EngineMode | undefined,
): { readonly args: readonly string[]; readonly option: EngineMode | undefined } {
  if (!args.includes('--jvm')) return { args, option }
  return { args: args.filter((arg) => arg !== '--jvm'), option: option ?? 'jvm' }
}

const SOURCE_NAMES: Readonly<Record<EngineModeSource, string>> = {
  'package.yaml': 'package.yaml',
  option: '--engine-mode',
  environment: 'ENSO_ENGINE_MODE',
  default: 'default',
}

/** The engine log panel's first line. */
export function describeEngineMode(resolved: ResolvedEngineMode): string {
  return `Engine mode: ${resolved.mode} (${SOURCE_NAMES[resolved.source]})`
}
