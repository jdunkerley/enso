/**
 * @file The JDK AOT start-up cache for the harness's `--engines jvm` runs: recorded on a training
 * launch, created with the bundle's `java`, then checked. A cache cannot be moved, so it is made in
 * place, under `<out>/aot/`. See the rulings in
 * `docs/superpowers/plans/2026-11-01-project-open-performance.md` (Task 1).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findBundledJava, findEngineComponent } from '../tests/packagedIde'
import { credentialFreeEnv, type OpenTag, type RunResult } from './openTimeReport'

/** The options the launcher gives the JVM it starts through JNI (`Main.launchJvm`). */
const LAUNCHER_JVM_OPTIONS = [
  '--sun-misc-unsafe-memory-access=allow',
  '--enable-native-access=org.graalvm.truffle',
  '--add-opens=java.base/java.nio=ALL-UNNAMED',
]

type Launch = (
  env: Record<string, string>,
  opens: readonly OpenTag[],
) => Promise<RunResult & { readonly stdout: string }>

/** `JAVA_TOOL_OPTIONS` for a measured launch: the cache, and no JVM logging on stdout. */
export function measuredJvmToolOptions(cache: string): string {
  return `-XX:AOTCache=${cache} -Xlog:disable -Xlog:all=off`
}

/** How long `-XX:AOTMode=create` may take. */
const CREATE_TIMEOUT_MS = 5 * 60_000

/**
 * Record, create and check the cache; returns its path, or throws saying which stage failed. A
 * rejected cache is made once more: every JVM that exits during the training launch writes the
 * configuration, and the last writer wins.
 */
export async function createJvmAotCache(out: string, exe: string, launch: Launch): Promise<string> {
  try {
    return await prepareJvmAotCache(out, exe, launch)
  } catch (e) {
    if (!String(e).includes('rejected the AOT cache')) throw e
    console.warn(`Open time: ${String(e)}; preparing the AOT cache once more.`)
    return await prepareJvmAotCache(out, exe, launch)
  }
}

async function prepareJvmAotCache(out: string, exe: string, launch: Launch): Promise<string> {
  const java = findBundledJava(exe)
  const component = findEngineComponent(exe)
  if (!java || !component) throw new Error(`No bundled JDK or engine component next to ${exe}`)
  const dir = path.join(out, 'aot')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const config = path.join(dir, 'enso.aotconf')
  const cache = path.join(dir, 'enso.aot')

  const training = await launch(
    {
      ENSO_ENGINE_ARGS: '--jvm',
      JAVA_TOOL_OPTIONS: `-XX:AOTMode=record -XX:AOTConfiguration=${config}`,
    },
    ['first'],
  )
  if (!fs.existsSync(config)) {
    throw new Error(
      `The JVM wrote no AOT configuration (training launch: ${training.error ?? 'no error'})`,
    )
  }

  const created = spawnSync(
    java,
    [
      '-XX:AOTMode=create',
      `-XX:AOTConfiguration=${config}`,
      `-XX:AOTCache=${cache}`,
      ...LAUNCHER_JVM_OPTIONS,
      `--module-path=${component}`,
      '-m',
      'org.enso.runner/org.enso.runner.Main',
    ],
    {
      encoding: 'utf8',
      // The repo types `ProcessEnv` as closed; a spawned process takes any variable.
      env: credentialFreeEnv(process.env) as NodeJS.ProcessEnv,
      timeout: CREATE_TIMEOUT_MS,
    },
  )
  if (created.status !== 0 || !fs.existsSync(cache)) {
    throw new Error(
      `Creating the AOT cache failed (${created.status}): ${created.stdout}${created.stderr}`,
    )
  }

  // A cache the JVM cannot use is reported on stdout as an `[aot]` error or warning, and the JVM
  // then runs without it, so this launch keeps the JVM's logging on.
  const check = await launch(
    { ENSO_ENGINE_ARGS: '--jvm', JAVA_TOOL_OPTIONS: `-XX:AOTCache=${cache}` },
    ['first'],
  )
  const rejected = check.stdout.split('\n').find((line) => /\[(error|warning)\]\[aot/.test(line))
  if (rejected) throw new Error(`The JVM rejected the AOT cache: ${rejected}`)
  return cache
}
