/**
 * @file The command line of an engine: the bundled `java` and the options of Note [JVM Options Of
 * The Engine]. The IDE's shim starts the JVM itself, for every engine it runs (`--server`,
 * `--run`, `--standby`, `--new`, `--version` and the AOT training), so the process it holds, writes
 * stdin to and kills is the JVM. `bin/enso` and `bin/enso.bat` are for people at a terminal.
 *
 * ```
 * <runtime>/bin/java[.exe]
 *   <jvm.options lines>          (the fixed options first: --enable-native-access=…, --add-opens=…)
 *   <ENSO_JVM_OPTIONS options>
 *   <extra options>              (the AOT cache's, or a training's)
 *   --module-path <engine>/component -m org.enso.runner/org.enso.runner.Main
 *   <engine arguments>
 * ```
 */
import * as path from 'node:path'
import { enginePathsSync, readJvmOptionsTextSync } from '../jvmAot/key.js'
import { parseJvmOptionsFile, splitJvmOptions } from './jvmOptions.js'

/** The runner's module and main class (`java -m`). */
export const ENGINE_MAIN = 'org.enso.runner/org.enso.runner.Main'

/** The process to spawn: a command and its arguments. */
export type SpawnCommand = readonly [command: string, args: readonly string[]]

/**
 * Builds the process of an engine from its arguments (`--server …`) and the JVM options of this
 * launch (the AOT cache's). Tests replace it with a fake engine.
 */
export type EngineCommand = (
  args: readonly string[],
  jvmOptions?: readonly string[],
) => SpawnCommand

/** The JVM and the engine distribution an engine launcher starts. */
export interface JavaEngine {
  /** The bundled runtime's `bin/java[.exe]`; plain `java` (from `PATH`) when there is none. */
  readonly javaExecutable: string
  /** The engine package: `component/` and `jvm.options` are in it. */
  readonly engineRoot: string
}

/**
 * The engine whose launcher is `ensoExecutable` (`<root>/dist/<version>/bin/enso`): the bundle's one
 * `runtime/graalvm-*` directory, as the AOT cache key resolves it (`jvmAot/key.ts`). A development
 * build has no bundled runtime and runs the `java` it finds, as `bin/enso` does.
 */
export function resolveJavaEngine(ensoExecutable: string): JavaEngine {
  const paths = enginePathsSync(ensoExecutable)
  if (paths != null) {
    const java = process.platform === 'win32' ? 'java.exe' : 'java'
    return {
      javaExecutable: path.join(paths.runtimeRoot, 'bin', java),
      engineRoot: paths.engineRoot,
    }
  }
  return {
    javaExecutable: 'java',
    engineRoot: path.resolve(path.dirname(path.dirname(ensoExecutable))),
  }
}

/** What {@link javaCommand} puts around the engine's arguments. */
export interface JavaCommandOptions {
  /** The text of the engine's `jvm.options`; read from `engine.engineRoot` when omitted. */
  readonly jvmOptionsText?: string | undefined
  /** The raw `ENSO_JVM_OPTIONS`; the process environment's when omitted. */
  readonly environment?: string | undefined
  /** Options after those of the environment: the AOT cache's, or a training's. */
  readonly extraJvmOptions?: readonly string[] | undefined
}

/**
 * The JVM options of an engine, in order: `jvm.options`, `ENSO_JVM_OPTIONS`, then `extra` (the same
 * order `Main.launchJvm` and `bin/enso` use, and the one an AOT cache is created with).
 */
export function jvmArguments(
  engine: JavaEngine,
  options: JavaCommandOptions = {},
): readonly string[] {
  const text = options.jvmOptionsText ?? readJvmOptionsTextSync(engine.engineRoot)
  const environment = options.environment ?? process.env.ENSO_JVM_OPTIONS
  return [
    ...parseJvmOptionsFile(text),
    ...splitJvmOptions(environment ?? ''),
    ...(options.extraJvmOptions ?? []),
  ]
}

/** The command of `engine` with `args` for the runner (see the file comment). */
export function javaCommand(
  engine: JavaEngine,
  args: readonly string[],
  options: JavaCommandOptions = {},
): SpawnCommand {
  return [
    engine.javaExecutable,
    [
      ...jvmArguments(engine, options),
      '--module-path',
      path.join(engine.engineRoot, 'component'),
      '-m',
      ENGINE_MAIN,
      ...args,
    ],
  ]
}

/** The {@link EngineCommand} of the engine whose launcher is `ensoExecutable`. */
export function javaEngineCommand(ensoExecutable: string): EngineCommand {
  let engine: JavaEngine | undefined
  return (args, jvmOptions) => {
    // Resolved at the first launch: the bundle is read when an engine starts, not when the runner
    // is made (a test's runner names an executable that does not exist).
    engine ??= resolveJavaEngine(ensoExecutable)
    return javaCommand(engine, args, { extraJvmOptions: jvmOptions })
  }
}

/**
 * The arguments of the `java` that creates an AOT cache from a training run's configuration. It
 * is the JVM an engine would start (same options, module path and main class), since a cache must
 * be created with the options it was trained with.
 */
export function aotCreateArguments(
  engine: JavaEngine,
  options: {
    readonly config: string
    readonly cache: string
    readonly jvmOptionsText?: string | undefined
    readonly environment?: string | undefined
  },
): readonly string[] {
  return javaCommand(engine, [], {
    jvmOptionsText: options.jvmOptionsText,
    environment: options.environment,
    extraJvmOptions: [
      '-XX:AOTMode=create',
      `-XX:AOTConfiguration=${options.config}`,
      `-XX:AOTCache=${options.cache}`,
    ],
  })[1]
}
