/** @file Where the JDK AOT cache lives and when it trains: kept free of `electron` so it can be tested. */
import * as path from 'node:path'
import { resolveDefaultEngineMode, type EngineSettings } from 'project-manager-shim/projectService'

/** `ENSO_JVM_AOT_DIR` when it is set and not empty, else `<userData>/jvm-aot`. */
export function jvmAotRootDirectory(
  env: Readonly<Record<string, string | undefined>>,
  userData: string,
): string {
  return env.ENSO_JVM_AOT_DIR || path.join(userData, 'jvm-aot')
}

/**
 * Whether the JVM is the resolved default engine (`--engine-mode`, `ENSO_ENGINE_MODE`, then the
 * built-in default): the AOT cache trains only then. A project's own `jvm:` key does not count.
 */
export function isJvmDefaultEngine(
  engine: EngineSettings | undefined,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    resolveDefaultEngineMode({ option: engine?.option, environment: env.ENSO_ENGINE_MODE }).mode ===
    'jvm'
  )
}
