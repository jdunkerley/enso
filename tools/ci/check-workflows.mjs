#!/usr/bin/env node
// Workflow policy: the rules that the retired Rust CI generator's unit tests enforced (the
// generator was removed in Phase 1 of the build simplification), checked against the hand-written
// workflows and composite actions instead.
// `.github/workflows/workflow-lint.yml` runs it after actionlint:
//
//     node tools/ci/check-workflows.mjs [repo-root]
//
// It prints one line per violation and exits 1 if there is any.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { readToolchainPins, TOOLCHAIN_PIN_FILES, TOOLCHAIN_PINS } from './toolchain-pins.mjs'

/** Specs and plans: a pull request that changes only these starts no workflow. */
export const SPEC_PATHS = 'docs/superpowers/**'

/** Test fixtures keyed by `component/truffle-*-<graalVersion>.jar`; see `checkNativeLibsFixtures`. */
export const NATIVE_LIBS_FILES = [
  'test/Base_Tests/data/native_libs.json',
  'test/Cloud_Tests/data/native_libs.json',
]

/** Files outside `.github` that a rule reads: the toolchain pins, and the build's own copies. */
export const ROOT_FILES = ['build-config.yaml', ...TOOLCHAIN_PIN_FILES, ...NATIVE_LIBS_FILES]

/** The TypeScript package whose commands workflows run with `corepack pnpm --filter build-scripts`. */
export const BUILD_SCRIPTS = 'tools/build-scripts'

/** Every `.ts` file under `dir`, as paths relative to `base` with `/` separators. */
function typeScriptFiles(dir, base) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return typeScriptFiles(full, base)
    return entry.name.endsWith('.ts') ? [path.relative(base, full).split(path.sep).join('/')] : []
  })
}

/**
 * `tools/build-scripts`: its `package.json` scripts and its `src/**\/*.ts` sources (paths relative
 * to the package), or `null` when the package does not exist.
 */
function loadBuildScripts(root) {
  const dir = path.join(root, BUILD_SCRIPTS)
  const manifest = path.join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {}
  const sources = {}
  for (const file of typeScriptFiles(path.join(dir, 'src'), dir)) {
    sources[file] = readFileSync(path.join(dir, file), 'utf8')
  }
  return { scripts, sources }
}

/**
 * Loads every workflow and every local composite action under `root/.github`, the `ROOT_FILES`
 * (`null` when absent), and `tools/build-scripts` (`null` when absent).
 */
export function loadRepo(root) {
  const read = (file) => {
    const text = readFileSync(file, 'utf8')
    return { text, doc: parse(text) }
  }
  const workflows = {}
  const workflowsDir = path.join(root, '.github', 'workflows')
  for (const file of readdirSync(workflowsDir).sort()) {
    if (/\.ya?ml$/.test(file)) workflows[file] = read(path.join(workflowsDir, file))
  }
  const actions = {}
  const actionsDir = path.join(root, '.github', 'actions')
  if (existsSync(actionsDir)) {
    for (const name of readdirSync(actionsDir).sort()) {
      const file = path.join(actionsDir, name, 'action.yml')
      if (existsSync(file)) actions[name] = read(file)
    }
  }
  const files = {}
  for (const file of ROOT_FILES) {
    const target = path.join(root, file)
    files[file] = existsSync(target) ? readFileSync(target, 'utf8') : null
  }
  return { workflows, actions, files, buildScripts: loadBuildScripts(root) }
}

function triggers(doc) {
  const on = doc?.on
  if (typeof on === 'string') return { [on]: null }
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [event, null]))
  return on ?? {}
}

const runsOnLabels = (job) => [job?.['runs-on'] ?? []].flat().map(String)
const isMacos = (job) => runsOnLabels(job).some((label) => /^macos/i.test(label))
const isWindowsOnly = (job) =>
  runsOnLabels(job).length > 0 && runsOnLabels(job).every((label) => /^windows/i.test(label))

/** Every `pull_request` trigger ignores specs and plans (CLAUDE.md, "PR CI skips ..."). */
export function checkPullRequestsIgnoreSpecs({ workflows }) {
  const problems = []
  for (const [file, { doc }] of Object.entries(workflows)) {
    const on = triggers(doc)
    for (const event of ['pull_request', 'pull_request_target']) {
      if (!(event in on)) continue
      const filter = on[event] ?? {}
      const ignored = filter['paths-ignore'] ?? []
      const only = filter.paths
      const ignoresSpecs =
        ignored.includes(SPEC_PATHS) ||
        (Array.isArray(only) && !only.some((pattern) => String(pattern).startsWith('docs/')))
      if (!ignoresSpecs) {
        problems.push(`${file}: its \`${event}\` trigger lacks \`paths-ignore: ["${SPEC_PATHS}"]\``)
      }
    }
  }
  return problems
}

/**
 * `actions/setup-node` caches the package manager's store by default (v5, from `packageManager`),
 * which needs `pnpm` on the PATH. A `setup-node` step that runs before `pnpm/action-setup` must
 * turn that off (the generator's `setup_node_steps_disable_package_manager_cache`).
 */
export function checkSetupNodeCache({ workflows, actions }) {
  const problems = []
  let checked = 0
  const check = (where, steps) => {
    let pnpmReady = false
    for (const step of steps ?? []) {
      const uses = String(step?.uses ?? '')
      if (uses.startsWith('pnpm/action-setup@')) pnpmReady = true
      if (!uses.startsWith('actions/setup-node@') || pnpmReady) continue
      checked++
      const cache = step.with?.['package-manager-cache']
      if (cache !== false && cache !== 'false') {
        problems.push(
          `${where}: \`${step.name ?? uses}\` runs before pnpm is set up, so it needs \`package-manager-cache: false\``,
        )
      }
    }
  }
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) check(`${file} › ${id}`, job?.steps)
  }
  for (const [name, { doc }] of Object.entries(actions)) {
    check(`.github/actions/${name}`, doc?.runs?.steps)
  }
  if (checked === 0) problems.push('no `setup-node` step runs before pnpm is set up: nothing was checked')
  return problems
}

const RELEASE_FORBIDDEN = [
  'deploy-runtime',
  'dispatch-build-image',
  'upload-backend',
  'ARTEFACT_S3',
  'ECR_PUSH',
  'CI_PRIVATE_TOKEN',
  'Download Edition File',
  '--backend-source release',
]
const RELEASE_REQUIRED = [
  'run release create-draft',
  'run release upload-ide',
  'run release publish',
  'run release update-latest-version',
  'ENSO_BUILD_UPDATE_INFO',
]
/**
 * The workflow token and the self-hosted Mac's status check. The fork ships unsigned and without
 * Sentry (build simplification, Phase 4): signing comes back as electron-builder's own settings,
 * with its secrets added here.
 */
const RELEASE_SECRETS = new Set(['GITHUB_TOKEN', 'RUNNER_STATUS_TOKEN'])

/** Releases are IDE-only GitHub releases and need no cloud secrets (`release_is_ide_only_...`). */
export function checkReleaseIsIdeOnly({ workflows }) {
  const release = workflows['release.yml']
  if (!release) return ['release.yml: missing']
  const problems = []
  for (const text of RELEASE_FORBIDDEN) {
    if (release.text.includes(text)) problems.push(`release.yml: still contains \`${text}\``)
  }
  for (const text of RELEASE_REQUIRED) {
    if (!release.text.includes(text)) problems.push(`release.yml: lacks \`${text}\``)
  }
  const secrets = new Set([...release.text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
  for (const secret of secrets) {
    if (!RELEASE_SECRETS.has(secret)) problems.push(`release.yml: reads secret \`${secret}\``)
  }
  return problems
}

/** The macOS jobs of `release.yml`: the Mac builds the backend and the IDE, nothing else. */
const MACOS_RELEASE_JOBS = ['build-backend-macos', 'upload-ide-macos']

/** Only macOS jobs may fail without blocking publishing (`only_macos_release_jobs_may_fail_...`). */
export function checkOnlyMacosReleaseJobsMayFail({ workflows }) {
  const jobs = Object.entries(workflows['release.yml']?.doc?.jobs ?? {})
  const problems = []
  for (const [id, job] of jobs) {
    const tolerant = job?.['continue-on-error'] === true
    if (tolerant && !isMacos(job)) {
      problems.push(`release.yml › ${id}: only macOS jobs may set \`continue-on-error\``)
    }
    if (!tolerant && isMacos(job) && /build-backend|upload-ide/.test(id)) {
      problems.push(`release.yml › ${id}: a macOS backend or IDE job must not block publishing`)
    }
  }
  const macosIds = jobs.filter(([, job]) => isMacos(job)).map(([id]) => id)
  for (const required of MACOS_RELEASE_JOBS) {
    if (!macosIds.includes(required)) problems.push(`release.yml: has no macOS job \`${required}\``)
  }
  for (const id of macosIds) {
    if (!MACOS_RELEASE_JOBS.includes(id)) problems.push(`release.yml › ${id}: unexpected macOS job`)
  }
  return problems
}

/** A job that calls a reusable workflow for macOS (`with: { os: macos }`). */
const isMacosCaller = (job) => job?.with?.os === 'macos'

/**
 * The jobs of `file` that run on the Mac, or call a workflow for it, but do not wait for
 * `check-the-mac-os-runner` and run only when it reports the Mac online.
 */
function ungatedMacosJobs(file, jobs) {
  const problems = []
  const macos = (job) => isMacos(job) || isMacosCaller(job)
  if (!('check-the-mac-os-runner' in jobs) && Object.values(jobs).some(macos)) {
    problems.push(`${file}: has macOS jobs but no \`check-the-mac-os-runner\` gate job`)
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (!macos(job)) continue
    const needs = [job.needs ?? []].flat()
    if (
      !needs.includes('check-the-mac-os-runner') ||
      !String(job.if ?? '').includes('outputs.online')
    ) {
      problems.push(
        `${file} › ${id}: a macOS job must need \`check-the-mac-os-runner\` and run only when it reports the Mac online`,
      )
    }
  }
  return problems
}

/**
 * What `publish-release`'s `if` must test: the `publish` input (a release can stop at a checked
 * draft), and every job's result but macOS's.
 */
const PUBLISH_REQUIRES = [
  'inputs.publish',
  "needs.draft-release.result == 'success'",
  "needs.license-check.result == 'success'",
  "needs.upload-ide.result == 'success'",
]

/**
 * With the self-hosted Mac (#288), every macOS job waits for `check-the-mac-os-runner` and is
 * skipped while the Mac is offline, and publishing does not wait on macOS results
 * (`release_skips_macos_jobs_...`, `nightly_skips_macos_jobs_...`). The latest-version update
 * tests the publish job's result itself: by default a job is skipped when any job before it
 * failed, a macOS one included.
 */
export function checkMacosJobsAreGated({ workflows }) {
  const problems = []
  const nightly = workflows['engine-checks-nightly.yml']?.doc?.jobs
  if (nightly) {
    if (!Object.values(nightly).some(isMacosCaller)) {
      problems.push('engine-checks-nightly.yml: has no job that runs the platform checks on macOS')
    }
    problems.push(...ungatedMacosJobs('engine-checks-nightly.yml', nightly))
  }
  const release = workflows['release.yml']?.doc?.jobs
  if (!release) return problems
  problems.push(...ungatedMacosJobs('release.yml', release))
  const publish = release['publish-release']
  if (!publish) return [...problems, 'release.yml: has no `publish-release` job']
  const condition = String(publish.if ?? '')
  if (![publish.needs ?? []].flat().includes('upload-ide-macos')) {
    problems.push('release.yml › publish-release: must still need the macOS IDE upload')
  }
  if (/macos/i.test(condition)) {
    problems.push('release.yml › publish-release: its `if` must not wait on a macOS job')
  }
  for (const required of PUBLISH_REQUIRES) {
    if (!condition.includes(required)) {
      problems.push(`release.yml › publish-release: its \`if\` lacks \`${required}\``)
    }
  }
  const update = release['update-latest-release-version']
  if (!update) return [...problems, 'release.yml: has no `update-latest-release-version` job']
  if (!String(update.if ?? '').includes("needs.publish-release.result == 'success'")) {
    problems.push(
      "release.yml › update-latest-release-version: its `if` must test `needs.publish-release.result == 'success'`",
    )
  }
  return problems
}

/**
 * The suites `macos-checks.yml` runs on `inputs.libraries`, as the retired build CLI did on the
 * Mac.
 */
const MACOS_LIBRARY_SUITES = ['standard-library-in-native', 'standard-library', 'std-aws']

/**
 * `macos-checks.yml` (#288) runs only what its inputs ask for (`macos_checks_run_only_...`): it is
 * one call of `engine-checks-platform.yml` on the self-hosted Mac, which always builds the engine
 * distribution, runs the JVM tests on `inputs.engine`, and the three library suites on
 * `inputs.libraries` (else none, `[]`).
 */
export function checkMacosChecksRunWhatIsRequested({ workflows }) {
  const jobs = workflows['macos-checks.yml']?.doc?.jobs
  if (!jobs) return []
  const entries = Object.entries(jobs)
  if (entries.length !== 1) {
    return ['macos-checks.yml: must be one call of `engine-checks-platform.yml`']
  }
  const [[id, job]] = entries
  const where = `macos-checks.yml › ${id}`
  const problems = []
  if (job?.uses !== './.github/workflows/engine-checks-platform.yml') {
    problems.push(`${where}: must call \`engine-checks-platform.yml\``)
  }
  if (job?.if !== undefined) {
    problems.push(`${where}: the engine distribution must always be built`)
  }
  const inputs = job?.with ?? {}
  const runner = String(inputs.runner ?? '')
  if (!isMacosCaller(job) || !runner.includes('self-hosted') || !runner.includes('macOS')) {
    problems.push(`${where}: must run on the self-hosted Mac`)
  }
  if (String(inputs['jvm-tests'] ?? '').replace(/\s/g, '') !== '${{inputs.engine}}') {
    problems.push(`${where}: \`jvm-tests\` must be \`inputs.engine\``)
  }
  const suites = String(inputs['stdlib-suites'] ?? '').trim()
  const named = [...suites.matchAll(/"suite":\s*"([^"]+)"/g)].map((match) => match[1])
  if (
    !/^\$\{\{\s*inputs\.libraries\s*&&/.test(suites) ||
    !/\|\|\s*'\[\]'\s*\}\}$/.test(suites) ||
    named.join() !== MACOS_LIBRARY_SUITES.join()
  ) {
    problems.push(
      `${where}: \`stdlib-suites\` must be ${MACOS_LIBRARY_SUITES.join(', ')} on \`inputs.libraries\`, else \`[]\``,
    )
  }
  return problems
}

const IDE_FORBIDDEN = [
  'ENSO_TEST_USER',
  'ENSO_CLOUD_TEST_ACCOUNT',
  '.enso/credentials',
  'playwright/.auth',
  'MAPBOX',
]

/**
 * The IDE is local-only: packaging and the GUI end-to-end job need no Enso Cloud account
 * (`ide_jobs_need_no_cloud_account`).
 */
export function checkIdePackagingNeedsNoCloudAccount({ workflows }) {
  const problems = []
  for (const file of ['ide-packaging.yml', 'gui-checks.yml']) {
    const workflow = workflows[file]
    if (!workflow) {
      problems.push(`${file}: missing`)
      continue
    }
    for (const text of IDE_FORBIDDEN) {
      if (workflow.text.includes(text)) problems.push(`${file}: mentions \`${text}\``)
    }
  }
  return problems
}

/**
 * Windows packaging installs, starts and uninstalls the installer after uploading it, and only on
 * Windows (`windows_packaging_smoke_tests_the_installer`, #251).
 */
export function checkWindowsInstallerSmokeTest({ workflows }) {
  const jobs = Object.entries(workflows['ide-packaging.yml']?.doc?.jobs ?? {})
  const problems = []
  let found = false
  for (const [id, job] of jobs) {
    const steps = job?.steps ?? []
    steps.forEach((step, index) => {
      if (!String(step?.run ?? '').includes('tools/ci/windows-installer-smoke.ps1')) return
      found = true
      if (!/windows/i.test(String(step.if ?? '')) && !isWindowsOnly(job)) {
        problems.push(
          `ide-packaging.yml › ${id}: the installer smoke test must run only on Windows`,
        )
      }
      if (
        !steps
          .slice(0, index)
          .some((earlier) => String(earlier?.name ?? '').startsWith('Upload ide'))
      ) {
        problems.push(
          `ide-packaging.yml › ${id}: the installer must be uploaded before it is smoke-tested`,
        )
      }
    })
  }
  if (!found) problems.push('ide-packaging.yml: no step runs tools/ci/windows-installer-smoke.ps1')
  return problems
}

/**
 * `.github/actions/setup-jvm` installs the versions pinned under `toolchain:` in
 * `build-config.yaml`, read by `readToolchainPins` (`toolchain-pins.mjs`) exactly as its awk does.
 * sbt enforces its own copies (`Running on GraalVM version X. Expected GraalVM version Y.`, the
 * `flatc` version check, `sbt.version`), so each pin must equal the build's. A pin is a bare
 * version: `setup-jvm` reads it with awk, which does not unquote.
 */
export function checkToolchainPins({ files }) {
  const config = files?.['build-config.yaml']
  if (config == null) return ['build-config.yaml: missing']
  const toolchain = readToolchainPins(config)
  const problems = []
  const reported = new Set()
  for (const { pin, name, file, pattern } of TOOLCHAIN_PINS) {
    const pinned = toolchain[pin]
    if (reported.has(pin)) {
      // Already reported as missing or malformed.
    } else if (!pinned) {
      problems.push(`build-config.yaml: no \`toolchain.${pin}\` pin`)
      reported.add(pin)
    } else if (!/^[0-9][^\s"']*$/.test(pinned)) {
      problems.push(
        `build-config.yaml: \`toolchain.${pin}\` must be a bare version (setup-jvm reads it with awk), not ${pinned}`,
      )
      reported.add(pin)
    }
    if (reported.has(pin)) continue
    const found = files[file]?.match(pattern)?.[1]
    if (found == null) {
      problems.push(`${file}: no \`${name}\` found`)
    } else if (pinned !== found) {
      problems.push(
        `build-config.yaml: \`toolchain.${pin}\` is ${pinned}, but \`${name}\` in ${file} is ${found}`,
      )
    }
  }
  return problems
}

/**
 * The `native_libs.json` test fixtures list the native libraries inside GraalVM's Truffle jars and
 * are keyed by jar name (`component/truffle-api-<graalVersion>.jar`). A GraalVM bump that leaves
 * them behind fails only in the Standard Library test jobs, ~20 minutes in. So every key must name
 * the `graalVersion` in `project/Dependencies.scala`, and there must be a `truffle-api` key.
 */
export function checkNativeLibsFixtures({ files }) {
  const graalVersion = files?.['project/Dependencies.scala']?.match(TOOLCHAIN_PINS[0].pattern)?.[1]
  if (graalVersion == null) return ['project/Dependencies.scala: no `graalVersion` found']
  const problems = []
  for (const file of NATIVE_LIBS_FILES) {
    let keys
    try {
      keys = Object.keys(JSON.parse(files[file]))
    } catch {
      problems.push(`${file}: missing or not a JSON object`)
      continue
    }
    for (const key of keys) {
      const version = key.match(/-(\d[^/]*)\.jar$/)?.[1]
      if (version !== graalVersion) {
        problems.push(
          `${file}: \`${key}\` is not for \`graalVersion\` ${graalVersion} in project/Dependencies.scala`,
        )
      }
    }
    if (!keys.some((key) => key.includes('/truffle-api-'))) {
      problems.push(`${file}: no \`component/truffle-api-${graalVersion}.jar\` key`)
    }
  }
  return problems
}

// An inline `VAR=value ` assignment before a command.
const ASSIGN = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+`
// A wrapper's option or argument: `-x`, `--x=y`, a number or duration (`10`, `90m`), a quoted
// string, or an assignment (`env A=1`).
const WRAPPER_ARG = String.raw`(?:-\S+|\d+[smhd]?|"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))`
// A command that runs the rest of the line as a command. Not `command`: `command -v sbt` only asks.
const WRAPPER = String.raw`(?:time|timeout|nice|nohup|env|xvfb-run|stdbuf|exec|sudo)(?:\s+${WRAPPER_ARG})*\s+`
// Where a command starts: a line, after `;`, `&`, `|`, `(`, `{`, a backquote, `!`, `$(`, or a
// shell keyword.
const START = String.raw`(?:^|[;&|({\x60!]|\$\(|\b(?:then|do|else|if|elif|while|until)\s)`
// `sbt`, `sbt.bat` or `sbt.cmd`, perhaps behind a path (`./sbt`, `"$SBT_HOME/bin/sbt"`), perhaps
// quoted, and followed by the end of the command word.
const SBT_WORD = String.raw`"?(?:[^\s;&|()'"\x60]*[\\/])?sbt(?:\.bat|\.cmd)?"?(?=\s|$|[;&|)\x60])`

/**
 * A script line that calls `sbt` itself, as a command: at a command's start, optionally after
 * PowerShell's `&`, inline `VAR=value` assignments (`LC_ALL=C.UTF-8 sbt …`, the shape of the
 * retired build CLI's own call), wrappers (`timeout 90m`, `time`, `nice -n 10`, `env A=1`,
 * `xvfb-run -a`, …) and `cmd /c`. An argument named `sbt` is not a call: neither the retired build
 * CLI's `backend sbt` (the retired build CLI provisions sbt) nor `command -v sbt`.
 */
export const SBT_CALL = new RegExp(
  String.raw`${START}\s*(?:&\s*)?(?:${ASSIGN})*(?:${WRAPPER})*(?:cmd(?:\.exe)?\s+\/c\s+)?${SBT_WORD}`,
  'im',
)

/** A script handed to a shell: `bash -c "…"`, `sh -lc '…'`, `pwsh -Command "…"`. */
const SHELL_C =
  /\b(?:ba|z)?sh(?:\.exe)?\s+(?:-\w+\s+)*-\w*c\w*\s+(?:"([^"]*)"|'([^']*)')|\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-(?:c|Command)\s+(?:"([^"]*)"|'([^']*)')/gi

/** A `tools/build-scripts` command run from a workflow: `corepack pnpm --filter build-scripts run <command>`. */
const BUILD_SCRIPTS_RUN =
  /\bpnpm\b[^\n;&|]*?(?:--filter[= ]|-F\s*)build-scripts\b[^\n;&|]*?\brun\s+([\w:-]+)/g

/**
 * A `tools/build-scripts` source run with plain node, as its package scripts run it:
 * `node tools/build-scripts/src/commands/<command>.ts`, after any node options. Captures the path
 * within the package (`src/commands/<command>.ts`).
 */
const BUILD_SCRIPTS_NODE =
  /\bnode(?:\.exe)?\s+(?:-[-\w]+(?:=\S+)?\s+)*(?:\S*\/)?tools\/build-scripts\/(src\/[^\s'"`;&|]+\.ts)\b/g

/** The one module in `tools/build-scripts` that may start sbt. */
export const BUILD_SCRIPTS_SBT_HELPER = 'src/lib/sbt.ts'

/** A relative import or re-export in a TypeScript source: `from './x.ts'`, `import('./x.ts')`. */
const RELATIVE_IMPORT = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g

/**
 * A direct spawn of sbt: `spawn('sbt', …)`, `execFileSync("sbt.bat", …)`, `invocation('sbt', …)`
 * (`src/lib/repo.ts`' shell decision, which `src/lib/sbt.ts` itself uses) and the like.
 */
const SPAWNS_SBT =
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|capture|runInherited|invocation)\s*\(\s*['"`]sbt(?:\.bat|\.cmd)?['"`]/

/**
 * The `tools/build-scripts` commands that start sbt: those whose script (`node src/….ts`) reaches
 * `src/lib/sbt.ts` through relative imports. `checkBuildScriptsSpawnSbtThroughHelper` makes that
 * module the only way to start sbt, so this cannot miss one that starts sbt by name.
 */
export function buildScriptsSbtCommands(buildScripts) {
  const commands = new Set()
  if (buildScripts == null) return commands
  const reachesSbt = sbtReacher(buildScripts.sources)
  for (const [name, command] of Object.entries(buildScripts.scripts)) {
    const entry = String(command).match(/\bnode\s+(src\/\S+\.ts)\b/)?.[1]
    if (entry != null && reachesSbt(entry)) commands.add(name)
  }
  return commands
}

/**
 * The `tools/build-scripts` sources (`src/….ts`) that reach `src/lib/sbt.ts` through relative
 * imports: a step that runs one with plain node (`node tools/build-scripts/src/commands/<x>.ts`)
 * starts sbt, as the package script for it would.
 */
export function buildScriptsSbtEntries(buildScripts) {
  if (buildScripts == null) return new Set()
  const reachesSbt = sbtReacher(buildScripts.sources)
  return new Set(Object.keys(buildScripts.sources).filter((file) => reachesSbt(file)))
}

/** Whether a source in `sources` reaches `src/lib/sbt.ts` through relative imports. */
function sbtReacher(sources) {
  const reachesSbt = (file, seen) => {
    if (file === BUILD_SCRIPTS_SBT_HELPER) return true
    if (seen.has(file) || sources[file] == null) return false
    seen.add(file)
    for (const match of sources[file].matchAll(RELATIVE_IMPORT)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] ?? match[2]))
      if (reachesSbt(target, seen)) return true
    }
    return false
  }
  return (file) => reachesSbt(file, new Set())
}

/**
 * Whether a `run:` script calls sbt: directly (`SBT_CALL`), inside a `bash -c`/`pwsh -Command`
 * script, through a `tools/build-scripts` command in `sbtCommands`, or by running one of the
 * package's sources in `sbtEntries` with plain node.
 *
 * The recognised wrappers are a closed list (see `SBT_CALL`). Shapes it does not see: sbt behind a
 * variable used as the command (`$SBT_CALL compile`), a line continuation after an assignment or
 * wrapper, `xargs sbt`, and `/usr/bin/env sbt`.
 */
export function callsSbt(script, sbtCommands = new Set(), sbtEntries = new Set()) {
  if (SBT_CALL.test(script)) return true
  for (const match of script.matchAll(SHELL_C)) {
    const inner = match[1] ?? match[2] ?? match[3] ?? match[4]
    if (inner != null && callsSbt(inner, sbtCommands, sbtEntries)) return true
  }
  for (const match of script.matchAll(BUILD_SCRIPTS_RUN)) {
    if (sbtCommands.has(match[1])) return true
  }
  for (const match of script.matchAll(BUILD_SCRIPTS_NODE)) {
    if (sbtEntries.has(match[1])) return true
  }
  return false
}

/**
 * In `tools/build-scripts`, only `src/lib/sbt.ts` starts sbt. That is what lets the workflow
 * policy see which commands need `setup-jvm` (`buildScriptsSbtCommands`). Unit tests
 * (`*.test.ts`) are exempt: no command imports them, and `src/lib/repo.test.ts` checks the command
 * line `invocation('sbt', …)` builds without starting it.
 */
export function checkBuildScriptsSpawnSbtThroughHelper({ buildScripts = null }) {
  if (buildScripts == null) return []
  return Object.entries(buildScripts.sources)
    .filter(
      ([file, text]) =>
        file !== BUILD_SCRIPTS_SBT_HELPER && !file.endsWith('.test.ts') && SPAWNS_SBT.test(text),
    )
    .map(
      ([file]) =>
        `${BUILD_SCRIPTS}/${file}: starts sbt itself; use \`${BUILD_SCRIPTS_SBT_HELPER}\`, so the workflow policy sees it`,
    )
}

/** The local composite action a step uses (`./.github/actions/<name>`), or `null`. */
const localAction = (step) =>
  String(step?.uses ?? '').match(/^\.\/\.github\/actions\/([^/@]+)$/)?.[1] ?? null

/**
 * Whether running `steps` calls sbt before `setup-jvm`: directly, or through a local composite
 * action that itself does. `seen` guards against an action that uses itself.
 */
function sbtBeforeSetupJvm(steps, actions, sbt, seen = new Set()) {
  const late = []
  let ready = false
  for (const step of steps ?? []) {
    const action = localAction(step)
    if (action === 'setup-jvm') {
      ready = true
      continue
    }
    let runs = callsSbt(String(step?.run ?? ''), sbt.commands, sbt.entries)
    if (!runs && action && !seen.has(action) && actions[action]) {
      const inner = sbtBeforeSetupJvm(
        actions[action].doc?.runs?.steps,
        actions,
        sbt,
        new Set([...seen, action]),
      )
      runs = inner.length > 0
    }
    if (runs && !ready) late.push(step)
  }
  return late
}

/**
 * A job that calls `sbt` directly sets up GraalVM and sbt with `.github/actions/setup-jvm` in an
 * earlier step: the hosted images have no sbt, and their default JDK fails the build's GraalVM
 * check. A job that uses a local composite action calling sbt counts as calling sbt, unless the
 * action sets up the JVM first; an action that uses setup-jvm must do so before its own sbt calls.
 * A `tools/build-scripts` command that starts sbt (`buildScriptsSbtCommands`), or one of its
 * sources that does, run with plain node (`buildScriptsSbtEntries`), counts as calling it.
 */
export function checkSbtRunsAfterSetupJvm({ workflows, actions = {}, buildScripts = null }) {
  const problems = []
  const sbt = {
    commands: buildScriptsSbtCommands(buildScripts),
    entries: buildScriptsSbtEntries(buildScripts),
  }
  const describe = (step) => step.name ?? step.uses ?? step.run
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      for (const step of sbtBeforeSetupJvm(job?.steps, actions, sbt)) {
        problems.push(
          `${file} › ${id}: \`${describe(step)}\` runs sbt before \`./.github/actions/setup-jvm\``,
        )
      }
    }
  }
  for (const [name, { doc }] of Object.entries(actions)) {
    // An action without setup-jvm leaves it to its callers, which the loop above checks.
    if (!(doc?.runs?.steps ?? []).some((step) => localAction(step) === 'setup-jvm')) continue
    for (const step of sbtBeforeSetupJvm(doc?.runs?.steps, actions, sbt, new Set([name]))) {
      if (localAction(step)) continue // Reported where that action's own steps run sbt.
      problems.push(
        `actions/${name}: \`${describe(step)}\` runs sbt before \`./.github/actions/setup-jvm\``,
      )
    }
  }
  return problems
}

/**
 * A job left without `timeout-minutes` runs for GitHub's default of 6 hours when it hangs (#406's
 * JVM tests hung for 2 hours until cancelled). Jobs that call a reusable workflow cannot set it;
 * the called workflow's jobs do.
 */
export function checkJobsHaveTimeouts({ workflows }) {
  const problems = []
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      if (job?.uses || job?.['timeout-minutes'] !== undefined) continue
      problems.push(`${file}: job \`${id}\` has no \`timeout-minutes\` (the default is 6 hours)`)
    }
  }
  return problems
}

export const CHECKS = [
  checkPullRequestsIgnoreSpecs,
  checkSetupNodeCache,
  checkReleaseIsIdeOnly,
  checkOnlyMacosReleaseJobsMayFail,
  checkMacosJobsAreGated,
  checkMacosChecksRunWhatIsRequested,
  checkIdePackagingNeedsNoCloudAccount,
  checkWindowsInstallerSmokeTest,
  checkToolchainPins,
  checkNativeLibsFixtures,
  checkSbtRunsAfterSetupJvm,
  checkBuildScriptsSpawnSbtThroughHelper,
  checkJobsHaveTimeouts,
]

/** Every violation in the repository at `root`, one message each. */
export function checkRepo(root) {
  const repo = loadRepo(root)
  return CHECKS.flatMap((check) => check(repo))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRepo(path.resolve(process.argv[2] ?? '.'))
  for (const problem of problems) console.log(problem)
  if (problems.length > 0) {
    console.log(`\n${problems.length} workflow policy violation(s).`)
    process.exit(1)
  }
  console.log('Workflow policy: OK')
}
