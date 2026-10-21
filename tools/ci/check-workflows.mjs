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

/** Specs and plans: a pull request that changes only these starts no workflow. */
export const SPEC_PATHS = 'docs/superpowers/**'

/** Files outside `.github` that a rule reads: the toolchain pins, and the build's own copies. */
export const ROOT_FILES = [
  'build-config.yaml',
  'project/Dependencies.scala',
  'project/build.properties',
]

/**
 * Loads every workflow and every local composite action under `root/.github`, and the
 * `ROOT_FILES` (`null` when absent).
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
  return { workflows, actions, files }
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
  'release create-draft',
  'release publish',
  'update-latest-version',
  'ide upload',
  'ENSO_BUILD_UPDATE_INFO',
]
/** The workflow token, code signing, Sentry source maps, and the self-hosted Mac's status check. */
const RELEASE_SECRETS = new Set([
  'GITHUB_TOKEN',
  'APPLE_CODE_SIGNING_CERT',
  'APPLE_CODE_SIGNING_CERT_PASSWORD',
  'APPLE_NOTARIZATION_USERNAME',
  'APPLE_NOTARIZATION_PASSWORD',
  'APPLE_NOTARIZATION_TEAM_ID',
  'MICROSOFT_CODE_SIGNING_CERT',
  'MICROSOFT_CODE_SIGNING_CERT_PASSWORD',
  'SENTRY_AUTH_TOKEN',
  'RUNNER_STATUS_TOKEN',
])

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
const MACOS_RELEASE_JOBS = [
  'build-script-macos-aarch64',
  'enso-build-ci-gen-job-build-backend-macos-aarch64',
  'enso-build-ci-gen-upload-ide-macos-aarch64',
]

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
  if (!macosIds.some((id) => /upload-ide/.test(id))) {
    problems.push('release.yml: has no macOS IDE upload job')
  }
  return problems
}

/**
 * With the self-hosted Mac (#288), every macOS job waits for `check-the-mac-os-runner` and is
 * skipped while the Mac is offline, and publishing does not wait on macOS results
 * (`release_skips_macos_jobs_...`, `nightly_skips_macos_jobs_...`). Applies once a workflow has
 * that gate job.
 */
export function checkMacosJobsAreGated({ workflows }) {
  const problems = []
  for (const file of ['release.yml', 'engine-checks-nightly.yml']) {
    if (!workflows[file]) continue
    const jobs = workflows[file].doc?.jobs ?? {}
    if (file === 'engine-checks-nightly.yml' && !('build-script-macos-aarch64' in jobs)) {
      problems.push(`${file}: has no macOS job \`build-script-macos-aarch64\``)
    }
    if (!('check-the-mac-os-runner' in jobs) && Object.values(jobs).some(isMacos)) {
      problems.push(`${file}: has macOS jobs but no \`check-the-mac-os-runner\` gate job`)
    }
    for (const [id, job] of Object.entries(jobs)) {
      if (!isMacos(job)) continue
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
  }
  const release = workflows['release.yml']?.doc?.jobs
  if (release) {
    const entry = Object.entries(release).find(([id]) => id.includes('publish-release'))
    if (!entry) return [...problems, 'release.yml: has no publish job']
    const [id, publish] = entry
    const condition = String(publish.if ?? '')
    const needs = [publish.needs ?? []].flat()
    if (!needs.some((need) => /upload-ide-macos/.test(need))) {
      problems.push(`release.yml › ${id}: must still need the macOS IDE upload`)
    }
    if (/macos/i.test(condition)) {
      problems.push(`release.yml › ${id}: its \`if\` must not wait on a macOS job`)
    }
    for (const required of [
      'upload-ide-linux-amd64',
      'upload-ide-windows-amd64',
      'draft-release',
    ]) {
      if (!condition.includes(required)) {
        problems.push(`release.yml › ${id}: its \`if\` lacks ${required}`)
      }
    }
  }
  return problems
}

/** `macos-checks.yml` (#288) runs only what its inputs ask for (`macos_checks_run_only_...`). */
export function checkMacosChecksRunWhatIsRequested({ workflows }) {
  const jobs = workflows['macos-checks.yml']?.doc?.jobs
  if (!jobs) return []
  const problems = []
  const conditions = Object.entries(jobs).map(([id, job]) => [id, job?.if])
  if (!conditions.some(([id]) => /build-engine-distribution/.test(id))) {
    problems.push('macos-checks.yml: has no engine distribution job')
  }
  for (const [id, condition] of conditions) {
    if (/build-engine-distribution/.test(id) && condition !== undefined) {
      problems.push(`macos-checks.yml › ${id}: the engine distribution must always be built`)
    }
  }
  const count = (input) => conditions.filter(([, condition]) => condition === input).length
  if (count('inputs.engine') !== 1) {
    problems.push('macos-checks.yml: exactly one job must run on `inputs.engine`')
  }
  if (count('inputs.libraries') !== 3) {
    problems.push('macos-checks.yml: exactly three jobs must run on `inputs.libraries`')
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (!isMacos(job)) problems.push(`macos-checks.yml › ${id}: must run on macOS`)
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

/** Where the build keeps its own copy of each `toolchain:` pin in `build-config.yaml`. */
const TOOLCHAIN_PINS = [
  {
    pin: 'graalvm',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val graalVersion\s*=\s*"([^"]+)"/m,
  },
  {
    pin: 'flatc',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val flatbuffersVersion\s*=\s*"([^"]+)"/m,
  },
  { pin: 'sbt', file: 'project/build.properties', pattern: /^sbt\.version\s*=\s*(\S+)/m },
]

/**
 * `.github/actions/setup-jvm` installs the versions pinned under `toolchain:` in
 * `build-config.yaml`. sbt enforces its own copies (`Running on GraalVM version X. Expected GraalVM
 * version Y.`, the `flatc` version check, `sbt.version`), so each pin must equal the build's.
 */
export function checkToolchainPins({ files }) {
  const config = files?.['build-config.yaml']
  if (config == null) return ['build-config.yaml: missing']
  const toolchain = parse(config)?.toolchain ?? {}
  const problems = []
  for (const { pin, file, pattern } of TOOLCHAIN_PINS) {
    const pinned = toolchain[pin]
    if (pinned == null) {
      problems.push(`build-config.yaml: no \`toolchain.${pin}\` pin`)
      continue
    }
    const found = files[file]?.match(pattern)?.[1]
    if (found == null) {
      problems.push(`${file}: no ${pin} version found`)
    } else if (String(pinned) !== found) {
      problems.push(
        `build-config.yaml: \`toolchain.${pin}\` is ${pinned}, but ${file} has ${found}`,
      )
    }
  }
  return problems
}

/** A step whose script calls `sbt` itself. `./run backend sbt` does not: `./run` provisions sbt. */
const runsSbt = (step) => /^\s*sbt(\s|$)/m.test(String(step?.run ?? ''))

/**
 * A job that calls `sbt` directly sets up GraalVM and sbt with `.github/actions/setup-jvm` in an
 * earlier step: the hosted images have no sbt, and their default JDK fails the build's GraalVM
 * check.
 */
export function checkSbtRunsAfterSetupJvm({ workflows }) {
  const problems = []
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      let ready = false
      for (const step of job?.steps ?? []) {
        if (String(step?.uses ?? '') === './.github/actions/setup-jvm') ready = true
        if (runsSbt(step) && !ready) {
          problems.push(
            `${file} › ${id}: \`${step.name ?? step.run}\` runs sbt before \`./.github/actions/setup-jvm\``,
          )
        }
      }
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
  checkSbtRunsAfterSetupJvm,
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
