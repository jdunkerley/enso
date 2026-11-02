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

/** A launch of the IDE; `label` names its directory under `<out>`, so that its logs are kept. */
type Launch = (
  env: Record<string, string>,
  opens: readonly OpenTag[],
  label: string,
  beforeClose?: () => Promise<void>,
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

/**
 * The training and check launches log what the JVM does with the cache (`info` records, which
 * `aotRejection` ignores) to the engine's output, kept in their `electron-out.log`.
 */
const AOT_LOGGING = '-Xlog:aot=info,cds=info'

/* Note [The Training Launch Needs A Longer Start-up Timeout]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The project service kills an engine that has not passed its first health check within 30 s.
 * The training launch is a JVM with no class data sharing at all (the bundled runtime has no
 * default CDS archive) that also records every class it loads; on the Windows runner it was still
 * starting the Language Server after 30 s (run 41509148874: "Language server startup timeout",
 * the engine killed at 30.0 s), so it never exited by itself, wrote no configuration, and every
 * Windows JVM run fell back to a `launcher-trained` cache. The training launch gives the engine
 * 180 s (`ENSO_ENGINE_STARTUP_TIMEOUT_MS`, read by `ProjectService.default`).
 */
const TRAINING_STARTUP_TIMEOUT_MS = 180_000

/*
 * Note [The Training File Is Written After The Project Closes]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The recording JVM writes its configuration as it exits, which takes seconds (~6 s on the Linux
 * runner, more on Windows). Closing the IDE right after the project closed killed the engine in
 * the middle of it (run 41515109556: the Windows log stops at "Rewriting and linking classes"),
 * so no file, and a `launcher-trained` cache. The training launch keeps the IDE open until the
 * file has been written and has stopped growing, for at most `TRAINING_FILE_WAIT_MS`.
 */
const TRAINING_FILE_WAIT_MS = 180_000

async function waitForTrainingFile(config: string): Promise<void> {
  const end = Date.now() + TRAINING_FILE_WAIT_MS
  let size = -1
  while (Date.now() < end) {
    const now = fs.existsSync(config) ? fs.statSync(config).size : -1
    if (now > 0 && now === size) return
    size = now
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
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
      JAVA_TOOL_OPTIONS: `-XX:AOTMode=record -XX:AOTConfiguration=${config} ${AOT_LOGGING}`,
      ENSO_ENGINE_STARTUP_TIMEOUT_MS: String(TRAINING_STARTUP_TIMEOUT_MS),
    },
    ['first'],
    'jvm-aot-train',
    () => waitForTrainingFile(config),
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
    {
      ENSO_ENGINE_ARGS: '--jvm',
      JAVA_TOOL_OPTIONS: `-XX:AOTMode=on -XX:AOTCache=${cache} ${AOT_LOGGING}`,
    },
    ['first'],
    'jvm-aot-check',
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
