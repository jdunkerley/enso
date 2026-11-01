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
import {
  aotRejection,
  credentialFreeEnv,
  LAUNCHER_JVM_OPTIONS,
  type OpenTag,
  type RunResult,
} from './openTimeReport'

type Launch = (
  env: Record<string, string>,
  opens: readonly OpenTag[],
) => Promise<RunResult & { readonly stdout: string }>

/** Runs a new project to its end with the launcher, under the given environment. */
type TrainDirect = (env: Record<string, string>) => Promise<void>

/**
 * `JAVA_TOOL_OPTIONS` for a measured launch: the cache, and no JVM logging on stdout. `AOTMode=on`
 * makes the JVM fail to start when it cannot use the cache, instead of running without it (the
 * default, `auto`), so a measured launch is never an uncached one by accident.
 */
export function measuredJvmToolOptions(cache: string): string {
  return `-XX:AOTMode=on -XX:AOTCache=${cache} -Xlog:disable -Xlog:all=off`
}

/** What `createJvmAotCache` made. */
export interface JvmAotCache {
  /** The cache to measure with; `undefined` when the JVM could not use the cache it was given. */
  readonly cache: string | undefined
  /** Where the training ran, which decides what the cache holds. */
  readonly training: 'ide-trained' | 'launcher-trained'
  /** Why the JVM refused the cache, when `cache` is `undefined`. */
  readonly rejection?: string
}

/** How long `-XX:AOTMode=create` may take. */
const CREATE_TIMEOUT_MS = 5 * 60_000

/**
 * Record, create and check the cache; returns its path, or throws saying which stage failed. A
 * rejected cache is made once more: every JVM that exits during the training launch writes the
 * configuration, and the last writer wins.
 */
export async function createJvmAotCache(
  out: string,
  exe: string,
  launch: Launch,
  trainDirect: TrainDirect,
): Promise<JvmAotCache> {
  const first = await prepareJvmAotCache(out, exe, launch, trainDirect)
  if (first.cache != null) return first
  console.warn(`Open time: ${first.rejection}; preparing the AOT cache once more.`)
  return await prepareJvmAotCache(out, exe, launch, trainDirect)
}

async function prepareJvmAotCache(
  out: string,
  exe: string,
  launch: Launch,
  trainDirect: TrainDirect,
): Promise<JvmAotCache> {
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
  let trained: JvmAotCache['training'] = 'ide-trained'
  if (!fs.existsSync(config)) {
    trained = 'launcher-trained'
    // The JVM writes the configuration as it exits. Where the IDE ends the engine by killing it
    // (Windows) it never does, so the training is a project run to its end through the launcher.
    console.warn(
      `Open time: the IDE training launch wrote no AOT configuration (${training.error ?? 'no error'}); training with the launcher instead.`,
    )
    await trainDirect({
      ENSO_ENGINE_ARGS: '--jvm',
      JAVA_TOOL_OPTIONS: `-XX:AOTMode=record -XX:AOTConfiguration=${config}`,
    })
  }
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

  // With `AOTMode=on` a JVM that cannot use the cache fails to start, so the check launch fails to
  // open the project; one that can prints nothing. This launch keeps the JVM's logging on, so the
  // reason (a `[cds]` or `[aot]` record, a mismatch) is found in the output too.
  const check = await launch(
    { ENSO_ENGINE_ARGS: '--jvm', JAVA_TOOL_OPTIONS: `-XX:AOTMode=on -XX:AOTCache=${cache}` },
    ['first'],
  )
  const reason =
    aotRejection(check.stdout) ??
    (check.first.welcomeShown == null ?
      `the check launch did not open the project (${check.error ?? 'no error'})`
    : undefined)
  if (reason != null) {
    return {
      cache: undefined,
      training: trained,
      rejection: `The JVM rejected the AOT cache: ${reason}`,
    }
  }
  return { cache, training: trained }
}
