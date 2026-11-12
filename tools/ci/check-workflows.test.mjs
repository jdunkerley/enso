// Run with `node --test tools/ci/check-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildScriptsSbtCommands,
  buildScriptsSbtEntries,
  callsSbt,
  checkBuildScriptsSpawnSbtThroughHelper,
  checkChangedFilesCountDeletions,
  checkCleanAfterAlwaysRuns,
  checkCleanBuildVariableIsDefined,
  checkLocalActionsFollowCheckout,
  checkRunsOnResolvesAgainstItsMatrix,
  globMatches,
  pathsMatch,
  checkIdePackagingNeedsNoCloudAccount,
  checkJobsHaveTimeouts,
  checkMacosChecksRunWhatIsRequested,
  checkMacosJobsAreGated,
  checkMacosReleaseJobsAreRequired,
  checkOpenPerf,
  checkPublicTypes,
  checkPullRequestsIgnoreSpecs,
  checkReleaseIsIdeOnly,
  checkRepo,
  checkSbtRunsAfterSetupJvm,
  checkSetupNodeCache,
  checkStdlibTestMap,
  checkStdlibTestsGetTheGroupFilter,
  checkSuiteIgnoresBackendNames,
  checkNativeLibsFixtures,
  checkToolchainPins,
  checkWasmBindgenPins,
  checkWindowsInstallerSmokeTest,
  checkWorkflowsDeclarePermissions,
  exportedTypes,
  unreadableExports,
  loadRepo,
} from './check-workflows.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'check-workflows-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

let fixtureCount = 0
/**
 * A repository holding only the given `.github` files (paths relative to `.github`), and the given
 * files outside it (paths relative to the repository root).
 */
function fixture(files, rootFiles = {}) {
  const root = path.join(scratch, `repo-${fixtureCount++}`)
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, '.github', file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  for (const [file, text] of Object.entries(rootFiles)) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return loadRepo(root)
}

const GATE_IF = "if: needs.check-the-mac-os-runner.outputs.online == 'true'"

const RELEASE_OK = `
name: Release
on: workflow_dispatch
env:
  ENSO_BUILD_UPDATE_INFO: "true"
jobs:
  check-the-mac-os-runner:
    runs-on: ubuntu-latest
    steps:
      - run: ./tools/ci/wait-for-macos-runner.sh 12 fail
  draft-release:
    runs-on: ubuntu-latest
    steps:
      - run: corepack pnpm --filter build-scripts run release create-draft
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
  build-backend-macos:
    needs: [check-the-mac-os-runner]
    ${GATE_IF}
    runs-on: [self-hosted, macOS]
    steps: []
  upload-ide:
    runs-on: ubuntu-latest
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  upload-ide-macos:
    needs: [check-the-mac-os-runner, build-backend-macos]
    ${GATE_IF}
    runs-on: [self-hosted, macOS]
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  publish-release:
    runs-on: ubuntu-latest
    needs: [draft-release, license-check, upload-ide, upload-ide-macos]
    if: "!cancelled() && (inputs.release-id != '' || (inputs.publish && needs.draft-release.result == 'success' && needs.license-check.result == 'success' && needs.upload-ide.result == 'success' && needs.upload-ide-macos.result == 'success'))"
    steps:
      - run: corepack pnpm --filter build-scripts run release publish
  update-latest-release-version:
    runs-on: ubuntu-latest
    needs: [draft-release, publish-release]
    if: "!cancelled() && needs.publish-release.result == 'success'"
    steps:
      - run: corepack pnpm --filter build-scripts run release update-latest-version
`

describe('checkJobsHaveTimeouts', () => {
  test('accepts runner jobs with timeout-minutes, and reusable-workflow calls', () => {
    const repo = fixture({
      'workflows/a.yml':
        'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps: []\n  b:\n    uses: ./.github/workflows/c.yml\n',
    })
    assert.deepEqual(checkJobsHaveTimeouts(repo), [])
  })
  test('rejects a runner job without timeout-minutes', () => {
    const repo = fixture({
      'workflows/a.yml': 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n',
    })
    assert.deepEqual(checkJobsHaveTimeouts(repo), [
      'a.yml: job `a` has no `timeout-minutes` (the default is 6 hours)',
    ])
  })
})

describe('checkWorkflowsDeclarePermissions', () => {
  test('accepts a top-level permissions block, including an empty one', () => {
    const repo = fixture({
      'workflows/a.yml': 'on: push\npermissions:\n  contents: read\njobs: {}\n',
      'workflows/b.yml': 'on: push\npermissions: {}\njobs: {}\n',
    })
    assert.deepEqual(checkWorkflowsDeclarePermissions(repo), [])
  })
  test('rejects a workflow with only job-level permissions, or none', () => {
    const repo = fixture({
      'workflows/a.yml':
        'on: push\njobs:\n  a:\n    permissions:\n      checks: write\n    steps: []\n',
      'workflows/b.yml': 'on: push\njobs: {}\n',
    })
    assert.deepEqual(checkWorkflowsDeclarePermissions(repo), [
      'a.yml: no top-level `permissions:` (the default token can write)',
      'b.yml: no top-level `permissions:` (the default token can write)',
    ])
  })
})

describe('checkChangedFilesCountDeletions', () => {
  const gate = (outputs, extraSteps = '') => `on: workflow_call
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs:
${outputs}
    steps:
      - id: files
        uses: step-security/changed-files@v45
${extraSteps}`
  test('accepts the deletion-aware outputs, and job outputs named any_changed', () => {
    const repo = fixture({
      'workflows/a.yml': gate(
        '      any_changed: ${{ steps.files.outputs.any_modified }}\n      all_changed_files: ${{ steps.files.outputs.all_modified_files }}',
      ),
      'workflows/b.yml': `on: workflow_call
jobs:
  use:
    if: needs.gate.outputs.any_changed == 'true'
    runs-on: ubuntu-latest
    steps: []
`,
    })
    assert.deepEqual(checkChangedFilesCountDeletions(repo), [])
  })
  test('rejects any_changed and all_changed_files read from a changed-files step', () => {
    const repo = fixture({
      'workflows/a.yml': gate(
        '      any_changed: ${{ steps.files.outputs.any_changed }}',
        "      - if: steps.files.outputs.any_changed_excluding_tests == 'true'\n        run: echo ${{ steps.files.outputs.all_changed_files }}\n",
      ),
    })
    const problems = checkChangedFilesCountDeletions(repo)
    assert.equal(problems.length, 2)
    assert.match(problems[0], /^a\.yml: job `gate` reads `any_changed` .*use `any_modified` so deletions count$/)
    assert.match(problems[1], /reads `all_changed_files` .*use `all_modified_files` so deletions count$/)
  })
})

describe('checkPullRequestsIgnoreSpecs', () => {
  test('accepts paths-ignore with the spec paths, and a paths whitelist', () => {
    const repo = fixture({
      'workflows/a.yml':
        'on:\n  pull_request:\n    paths-ignore: ["docs/superpowers/**"]\njobs: {}\n',
      'workflows/b.yml': 'on:\n  pull_request:\n    paths: ["engine/**"]\njobs: {}\n',
      'workflows/c.yml': 'on: workflow_call\njobs: {}\n',
    })
    assert.deepEqual(checkPullRequestsIgnoreSpecs(repo), [])
  })
  test('rejects a pull_request trigger without the spec paths', () => {
    const repo = fixture({ 'workflows/a.yml': 'on: [push, pull_request]\njobs: {}\n' })
    assert.equal(checkPullRequestsIgnoreSpecs(repo).length, 1)
  })
})

describe('checkSetupNodeCache', () => {
  test('requires package-manager-cache: false before pnpm/action-setup, in workflows and actions', () => {
    const repo = fixture({
      'workflows/a.yml': `
on: push
jobs:
  ok:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { cache: pnpm }
  bad:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
`,
      'actions/setup-node/action.yml': `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v5
      with: { package-manager-cache: false }
`,
    })
    const problems = checkSetupNodeCache(repo)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /a\.yml › bad/)
  })
})

describe('checkReleaseIsIdeOnly', () => {
  test('accepts an IDE-only release', () => {
    assert.deepEqual(checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': RELEASE_OK })), [])
  })
  test('rejects cloud steps, signing secrets, and a missing release setting', () => {
    const text = RELEASE_OK.replace(
      'run release upload-ide\n  upload-ide-macos',
      'run release upload-ide --backend-source release\n  upload-ide-macos',
    )
      .replace('secrets.GITHUB_TOKEN', 'secrets.CI_PRIVATE_TOKEN')
      .replace(
        'ENSO_BUILD_UPDATE_INFO: "true"',
        'CSC_LINK: ${{ secrets.APPLE_CODE_SIGNING_CERT }}',
      )
    const problems = checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': text }))
    assert.ok(problems.some((p) => p.includes('--backend-source release')))
    assert.ok(problems.some((p) => p.includes('reads secret `CI_PRIVATE_TOKEN`')))
    assert.ok(problems.some((p) => p.includes('reads secret `APPLE_CODE_SIGNING_CERT`')))
    assert.ok(problems.some((p) => p.includes('lacks `ENSO_BUILD_UPDATE_INFO`')))
  })
})

describe('checkMacosReleaseJobsAreRequired', () => {
  const problems = (text) =>
    checkMacosReleaseJobsAreRequired(fixture({ 'workflows/release.yml': text }))
  test('accepts required macOS jobs and a runner check that fails', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('rejects continue-on-error on any job, macOS included', () => {
    const text = RELEASE_OK.replace(
      '    runs-on: [self-hosted, macOS]\n    steps:\n      - run',
      '    runs-on: [self-hosted, macOS]\n    continue-on-error: true\n    steps:\n      - run',
    ).replace(
      '  draft-release:\n    runs-on: ubuntu-latest',
      '  draft-release:\n    runs-on: ubuntu-latest\n    continue-on-error: true',
    )
    const found = problems(text)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('draft-release: must not set')))
    assert.ok(found.some((p) => p.includes('upload-ide-macos: must not set')))
  })
  test('rejects a runner check that skips instead of failing', () => {
    const found = problems(RELEASE_OK.replace('12 fail', '1 skip'))
    assert.ok(found.some((p) => p.includes('check-the-mac-os-runner: must run')))
  })
  test('rejects a release without its macOS IDE upload job, and an unexpected macOS job', () => {
    const found = problems(RELEASE_OK.replace('upload-ide-macos:', 'something-else:'))
    assert.ok(found.some((p) => p.includes('has no macOS job `upload-ide-macos`')))
    assert.ok(found.some((p) => p.includes('something-else: unexpected macOS job')))
  })
})

describe('checkMacosJobsAreGated', () => {
  const problems = (text) => checkMacosJobsAreGated(fixture({ 'workflows/release.yml': text }))
  test('accepts a gated release whose publish job waits on macOS', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('accepts a gated nightly', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  macos: { needs: [check-the-mac-os-runner], ${GATE_IF}, uses: ./.github/workflows/engine-checks-platform.yml, with: { os: macos } }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  test('rejects an ungated macOS call in the nightly, and a nightly with no macOS call', () => {
    const ungated = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  macos: { uses: ./.github/workflows/engine-checks-platform.yml, with: { os: macos } }
`,
    })
    const found = checkMacosJobsAreGated(ungated)
    assert.equal(found.length, 1)
    assert.match(found[0], /macos: a macOS job must need/)
    const none = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  linux: { uses: ./.github/workflows/engine-checks-platform.yml, with: { os: linux } }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(none), [
      'engine-checks-nightly.yml: has no job that runs the platform checks on macOS',
    ])
  })
  test('rejects macOS jobs when the gate job is missing', () => {
    const text = RELEASE_OK.replace(
      '  check-the-mac-os-runner:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./tools/ci/wait-for-macos-runner.sh 12 fail\n',
      '',
    )
    assert.ok(problems(text).some((p) => p.includes('no `check-the-mac-os-runner` gate job')))
  })
  test('rejects an ungated macOS job in the release', () => {
    const text = RELEASE_OK.replace(
      `  build-backend-macos:\n    needs: [check-the-mac-os-runner]\n    ${GATE_IF}\n`,
      '  build-backend-macos:\n',
    )
    assert.ok(problems(text).some((p) => p.includes('build-backend-macos: a macOS job must need')))
  })
  test('rejects a release with no publish job', () => {
    const text = RELEASE_OK.replace('publish-release:', 'something-else:')
    assert.ok(problems(text).some((p) => p.includes('no `publish-release` job')))
  })
  test('rejects a publish job that no longer needs the macOS upload', () => {
    const text = RELEASE_OK.replace(
      'needs: [draft-release, license-check, upload-ide, upload-ide-macos]',
      'needs: [draft-release, license-check, upload-ide]',
    )
    assert.ok(problems(text).some((p) => p.includes('must still need the macOS IDE upload')))
  })
  test('rejects a publish job that does not require macOS, and one that drops a required result', () => {
    const skips = problems(
      RELEASE_OK.replace(" && needs.upload-ide-macos.result == 'success'", ''),
    )
    assert.ok(skips.some((p) => p.includes("lacks `needs.upload-ide-macos.result == 'success'`")))
    const drops = problems(RELEASE_OK.replace(" && needs.license-check.result == 'success'", ''))
    assert.ok(drops.some((p) => p.includes("lacks `needs.license-check.result == 'success'`")))
    const unheld = problems(RELEASE_OK.replace('inputs.publish && ', ''))
    assert.ok(unheld.some((p) => p.includes('lacks `inputs.publish`')))
  })
  test('rejects a latest-version update that a failed macOS job would skip', () => {
    const text = RELEASE_OK.replace(
      `    if: "!cancelled() && needs.publish-release.result == 'success'"\n`,
      '',
    )
    assert.ok(
      problems(text).some((p) => p.includes('update-latest-release-version: its `if` must test')),
    )
  })
})

const MACOS_CHECKS_OK = `
on: workflow_call
jobs:
  macos:
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: macos
      arch: aarch64
      runner: '["self-hosted", "macOS"]'
      jvm-tests: \${{ inputs.engine }}
      stdlib-suites: >-
        \${{ inputs.libraries && '[{"suite": "standard-library"}, {"suite": "std-aws"}]' || '[]' }}
`

describe('checkMacosChecksRunWhatIsRequested', () => {
  const problems = (text) =>
    checkMacosChecksRunWhatIsRequested(fixture({ 'workflows/macos-checks.yml': text }))
  test('accepts one call that runs the JVM tests on engine and two suites on libraries', () => {
    assert.deepEqual(problems(MACOS_CHECKS_OK), [])
  })
  test('applies only once macos-checks.yml exists', () => {
    assert.deepEqual(checkMacosChecksRunWhatIsRequested(fixture({})), [])
  })
  test('rejects a missing library suite and an unrelated engine condition', () => {
    const text = MACOS_CHECKS_OK.replace(', {"suite": "std-aws"}', '').replace(
      'inputs.engine',
      'inputs.other',
    )
    const found = problems(text)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('`jvm-tests` must be `inputs.engine`')))
    assert.ok(found.some((p) => p.includes('`stdlib-suites` must be')))
  })
  test('rejects suites that run without inputs.libraries', () => {
    const text = MACOS_CHECKS_OK.replace("inputs.libraries && '", "true && '")
    assert.ok(problems(text).some((p) => p.includes('`stdlib-suites` must be')))
  })
  test('rejects a gated call, a second job, and another workflow', () => {
    assert.ok(
      problems(MACOS_CHECKS_OK.replace('    uses:', '    if: inputs.engine\n    uses:')).some((p) =>
        p.includes('must always be built'),
      ),
    )
    assert.deepEqual(problems(`${MACOS_CHECKS_OK}  other: { runs-on: ubuntu-latest, steps: [] }\n`), [
      'macos-checks.yml: must be one call of `engine-checks-platform.yml`',
    ])
    assert.ok(
      problems(MACOS_CHECKS_OK.replace('engine-checks-platform.yml', 'engine-checks.yml')).some(
        (p) => p.includes('must call `engine-checks-platform.yml`'),
      ),
    )
  })
  test('rejects a call that does not run on the self-hosted Mac', () => {
    const found = problems(
      MACOS_CHECKS_OK.replace(`'["self-hosted", "macOS"]'`, 'ubuntu-latest').replace(
        'os: macos',
        'os: linux',
      ),
    )
    assert.deepEqual(found, ['macos-checks.yml › macos: must run on the self-hosted Mac'])
  })
})

describe('IDE packaging', () => {
  const packaging = (smoke) => `
on: workflow_call
jobs:
  package-ide:
    runs-on: \${{ matrix.runner }}
    steps:
      - name: Upload ide
        uses: actions/upload-artifact@v5
      ${smoke}
`
  const smokeStep =
    "- if: matrix.os == 'windows'\n        run: ./tools/ci/windows-installer-smoke.ps1"
  const windowsJob = (steps) => `
on: workflow_call
jobs:
  package-ide:
    runs-on: [windows-latest]
    steps:
${steps}
`
  const upload = '      - name: Upload ide\n        uses: actions/upload-artifact@v5'
  const guiChecks = { 'workflows/gui-checks.yml': 'on: workflow_call\njobs: {}\n' }
  test('accepts a Windows-only smoke test after the upload', () => {
    const repo = fixture({ 'workflows/ide-packaging.yml': packaging(smokeStep), ...guiChecks })
    assert.deepEqual(checkWindowsInstallerSmokeTest(repo), [])
    assert.deepEqual(checkIdePackagingNeedsNoCloudAccount(repo), [])
  })
  test('rejects a smoke test on every platform, and a cloud account', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': packaging(
        '- run: ./tools/ci/windows-installer-smoke.ps1\n        env: { ENSO_TEST_USER: x }',
      ),
      ...guiChecks,
    })
    assert.equal(checkWindowsInstallerSmokeTest(repo).length, 1)
    assert.equal(checkIdePackagingNeedsNoCloudAccount(repo).length, 1)
  })
  test('rejects a cloud account in the GUI end-to-end workflow, and a missing one', () => {
    const packagingOnly = { 'workflows/ide-packaging.yml': packaging(smokeStep) }
    const repo = fixture({
      ...packagingOnly,
      'workflows/gui-checks.yml': 'on: workflow_call\nenv: { ENSO_TEST_USER: x }\njobs: {}\n',
    })
    assert.equal(checkIdePackagingNeedsNoCloudAccount(repo).length, 1)
    assert.equal(checkIdePackagingNeedsNoCloudAccount(fixture(packagingOnly)).length, 1)
  })
  test('rejects a smoke test that runs before the upload', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': windowsJob(
        `      - run: ./tools/ci/windows-installer-smoke.ps1\n${upload}`,
      ),
    })
    const found = checkWindowsInstallerSmokeTest(repo)
    assert.equal(found.length, 1)
    assert.match(found[0], /uploaded before it is smoke-tested/)
  })
  test('rejects packaging with no smoke test at all', () => {
    const repo = fixture({ 'workflows/ide-packaging.yml': windowsJob(upload) })
    assert.match(checkWindowsInstallerSmokeTest(repo)[0], /no step runs/)
  })
})

describe('open time', () => {
  const measure = (continueOnError, timeout = true) =>
    `      - name: Measure the open time\n        if: env.OPEN_PERF == 'true'\n        ${continueOnError ? 'continue-on-error: true\n        ' : ''}${timeout ? 'timeout-minutes: 25\n        ' : ''}run: corepack pnpm --filter enso run perf:open --out x`
  // The other open-time steps (find, download and upload the baseline) have no `run: perf:open`.
  const baselineStep = (continueOnError, timeout = true) =>
    `      - name: Find develop's last open time\n        if: env.OPEN_PERF == 'true'\n        ${continueOnError ? 'continue-on-error: true\n        ' : ''}${timeout ? 'timeout-minutes: 5\n        ' : ''}uses: actions/download-artifact@v5`
  const tests =
    '      - name: Run Package Tests\n        run: corepack pnpm -r --filter enso ide-integration-test'
  const conditionalJobTimeout = "${{ inputs.open_perf == true && 60 || 30 }}"
  const packagingWith = (steps, jobTimeout = conditionalJobTimeout) => `
on: workflow_call
jobs:
  package-ide:
    runs-on: ubuntu-latest
    timeout-minutes: ${jobTimeout}
    steps:
${steps.join('\n')}
`
  const label = (name) => `github.event.label.name != '${name}'`
  const pullRequest = (conditions) => `
on: pull_request
jobs:
${conditions.map((c, i) => `  job${i}:\n    if: "\${{ ${c} }}"\n`).join('')}`
  const both = `${label('CI: Build IDE')} && ${label('CI: Open perf')}`
  const repoWith = (steps, conditions = [both], jobTimeout) =>
    fixture({
      'workflows/ide-packaging.yml': packagingWith(steps, jobTimeout),
      'workflows/ide-pull-request.yml': pullRequest(conditions),
    })
  test('accepts a step after the package tests that continues on error', () => {
    assert.deepEqual(checkOpenPerf(repoWith([tests, measure(true)])), [])
  })
  test('rejects a step before the package tests, and one that can fail the job', () => {
    assert.equal(checkOpenPerf(repoWith([measure(true), tests])).length, 1)
    assert.equal(checkOpenPerf(repoWith([tests, measure(false)])).length, 1)
  })
  test('accepts the baseline steps too, when they continue on error with a timeout', () => {
    assert.deepEqual(checkOpenPerf(repoWith([tests, baselineStep(true), measure(true)])), [])
  })
  test('rejects an open-time step with no timeout, so a hang cannot reach the job timeout', () => {
    const problems = checkOpenPerf(repoWith([tests, measure(true, false)]))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /timeout-minutes/)
    assert.equal(checkOpenPerf(repoWith([tests, baselineStep(true, false), measure(true)])).length, 1)
  })
  test('rejects a baseline step that can fail the job', () => {
    const problems = checkOpenPerf(repoWith([tests, baselineStep(false), measure(true)]))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /continue on error/)
  })
  test('rejects a job timeout raised for every run, not only the measuring ones', () => {
    const problems = checkOpenPerf(repoWith([tests, measure(true)], [both], '90'))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /job timeout/)
  })
  test('rejects a step with no package tests at all', () => {
    assert.equal(checkOpenPerf(repoWith([measure(true)])).length, 1)
  })
  test('rejects a label test that does not exempt the open-time label', () => {
    const problems = checkOpenPerf(repoWith([tests, measure(true)], [both, label('CI: Build IDE')]))
    assert.equal(problems.length, 1)
    assert.match(problems[0], /1 unrelated-label test/)
  })
})

describe('checkToolchainPins', () => {
  /** A `Dependencies.scala` with the JDK, the release and GraalPy at the given versions. */
  const scalaWith = (jdk, release, graalpy) =>
    `object Dependencies {\n  val graalVersion = "${jdk}"\n  val graalMavenPackagesVersion = "${release}"\n  val graalPyVersion = "${graalpy}"\n  val flatbuffersVersion      = "24.3.25"\n}\n`
  const build = {
    'project/Dependencies.scala': scalaWith('25.0.1', '25.0.1', '25.0.1'),
    'project/build.properties': 'sbt.version=1.13.1\r\n',
  }
  const config = (pins) => `latest-release: 2025.3.4\ntoolchain:\n${pins}`
  /** The `toolchain:` block with the JDK, the release and GraalPy at the given versions. */
  const pinsWith = (jdk, release, graalpy) =>
    `  graalvm: ${release}\n  graalvm-jdk: ${jdk}\n  sbt: 1.13.1\n  flatc: 24.3.25\n  graalpy: ${graalpy}\n`
  const allPins = pinsWith('25.0.1', '25.0.1', '25.0.1')
  test("accepts pins equal to the build's own copies", () => {
    const repo = fixture({}, { 'build-config.yaml': config(allPins), ...build })
    assert.deepEqual(checkToolchainPins(repo), [])
  })
  test('accepts an innovation release: five-part versions, the JDK not the release', () => {
    const repo = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(pinsWith('25.0.5.0.3', '25.5.5.0.3', '25.5.5')),
        'project/Dependencies.scala': scalaWith('25.0.5.0.3', '25.5.5.0.3', '25.5.5'),
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [])
  })
  test('pairs each GraalVM pin with its own copy, not with the other two', () => {
    // The JDK and the release swapped, and GraalPy given the release's version.
    const repo = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(pinsWith('25.5.5.0.3', '25.0.5.0.3', '25.5.5.0.3')),
        'project/Dependencies.scala': scalaWith('25.0.5.0.3', '25.5.5.0.3', '25.5.5'),
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.5.0.3, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.5.5.0.3',
      'build-config.yaml: `toolchain.graalvm-jdk` is 25.5.5.0.3, but `graalVersion` in project/Dependencies.scala is 25.0.5.0.3',
      'build-config.yaml: `toolchain.graalpy` is 25.5.5.0.3, but `graalPyVersion` in project/Dependencies.scala is 25.5.5',
    ])
  })
  test('rejects a pin that drifted, and a missing pin', () => {
    const pins = '  graalvm: 25.0.2\n  sbt: 1.13.1\n  graalpy: 25.0.1\n'
    const problems = checkToolchainPins(fixture({}, { 'build-config.yaml': config(pins), ...build }))
    assert.deepEqual(problems.sort(), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.2, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.1',
      'build-config.yaml: no `toolchain.flatc` pin',
      'build-config.yaml: no `toolchain.graalvm-jdk` pin',
    ])
  })
  test('rejects a half-bumped GraalVM: the Maven packages behind the JDK', () => {
    const repo = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(pinsWith('25.0.5.0.3', '25.5.5.0.3', '25.5.5')),
        'project/Dependencies.scala': scalaWith('25.0.5.0.3', '25.0.1', '25.5.5'),
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [
      'build-config.yaml: `toolchain.graalvm` is 25.5.5.0.3, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.1',
    ])
  })
  test('compares versions as text, as the awk reader does', () => {
    const repo = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(pinsWith('25.0', '25.0', '25.0')),
        'project/Dependencies.scala': scalaWith('25.0', '25.0', '25.0'),
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [])
    const padded = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(pinsWith('25.0.1', '25.0.1.0', '25.0.1')),
        'project/Dependencies.scala': scalaWith('25.0.1', '25.0.1', '25.0.1'),
      },
    )
    assert.deepEqual(checkToolchainPins(padded), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.1.0, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.1',
    ])
  })
  test('rejects a quoted pin, which the awk reader would pass on with its quotes', () => {
    const pins = allPins.replace('25.0.1', '"25.0.1"')
    const repo = fixture({}, { ...build, 'build-config.yaml': config(pins) })
    assert.deepEqual(checkToolchainPins(repo), [
      'build-config.yaml: `toolchain.graalvm` must be a bare version (setup-jvm reads it with awk), not "25.0.1"',
    ])
  })
  test('rejects a build file without the version, and a missing build-config.yaml', () => {
    const repo = fixture(
      {},
      {
        'build-config.yaml': config(allPins),
        'project/Dependencies.scala': build['project/Dependencies.scala'].replace(
          /\n {2}val graalPyVersion.*/,
          '',
        ),
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [
      'project/Dependencies.scala: no `graalPyVersion` found',
      'project/build.properties: no `sbt.version` found',
    ])
    assert.deepEqual(checkToolchainPins(fixture({})), ['build-config.yaml: missing'])
  })
})

describe('checkNativeLibsFixtures', () => {
  const scala =
    'object Dependencies {\n  val graalVersion = "25.0.1"\n  val graalMavenPackagesVersion = "25.0.1"\n}\n'
  const libs = (version) =>
    JSON.stringify({
      [`component/truffle-api-${version}.jar`]: ['a.so'],
      [`component/truffle-nfi-libffi-${version}.jar`]: ['b.so'],
    })
  const repoWith = (base, cloud, dependencies = scala) =>
    fixture(
      {},
      {
        'project/Dependencies.scala': dependencies,
        'test/Base_Tests/data/native_libs.json': base,
        'test/Cloud_Tests/data/native_libs.json': cloud,
      },
    )
  test('accepts fixtures keyed by the graalMavenPackagesVersion', () => {
    assert.deepEqual(checkNativeLibsFixtures(repoWith(libs('25.0.1'), libs('25.0.1'))), [])
  })
  test('keys on the release, not the JDK, on the innovation line', () => {
    const innovation = scala
      .replace('graalVersion = "25.0.1"', 'graalVersion = "25.0.5.0.3"')
      .replace('graalMavenPackagesVersion = "25.0.1"', 'graalMavenPackagesVersion = "25.5.5.0.3"')
    assert.deepEqual(
      checkNativeLibsFixtures(repoWith(libs('25.5.5.0.3'), libs('25.5.5.0.3'), innovation)),
      [],
    )
    assert.deepEqual(
      checkNativeLibsFixtures(repoWith(libs('25.5.5.0.3'), libs('25.0.5.0.3'), innovation)),
      [
        'test/Cloud_Tests/data/native_libs.json: `component/truffle-api-25.0.5.0.3.jar` is not for `graalMavenPackagesVersion` 25.5.5.0.3 in project/Dependencies.scala',
        'test/Cloud_Tests/data/native_libs.json: `component/truffle-nfi-libffi-25.0.5.0.3.jar` is not for `graalMavenPackagesVersion` 25.5.5.0.3 in project/Dependencies.scala',
      ],
    )
  })
  test('rejects a fixture left behind by a GraalVM bump', () => {
    const problems = checkNativeLibsFixtures(repoWith(libs('25.0.1'), libs('25.0.0')))
    assert.deepEqual(problems, [
      'test/Cloud_Tests/data/native_libs.json: `component/truffle-api-25.0.0.jar` is not for `graalMavenPackagesVersion` 25.0.1 in project/Dependencies.scala',
      'test/Cloud_Tests/data/native_libs.json: `component/truffle-nfi-libffi-25.0.0.jar` is not for `graalMavenPackagesVersion` 25.0.1 in project/Dependencies.scala',
    ])
  })
  test('rejects a missing or malformed fixture, and a build without the release', () => {
    const problems = checkNativeLibsFixtures(repoWith(libs('25.0.1'), 'not json'))
    assert.deepEqual(problems, ['test/Cloud_Tests/data/native_libs.json: missing or not a JSON object'])
    const none = fixture({}, { 'project/Dependencies.scala': 'object Dependencies {}\n' })
    assert.deepEqual(checkNativeLibsFixtures(none), [
      'project/Dependencies.scala: no `graalMavenPackagesVersion` found',
    ])
  })
})

describe('checkSbtRunsAfterSetupJvm', () => {
  const SETUP = '      - uses: ./.github/actions/setup-jvm\n        with: { cache-key: a }\n'
  /** One job running `script` (the body of a `run: |` block) after the steps in `before`. */
  const job = (script, before = '') => {
    const body = script
      .split('\n')
      .map((line) => `          ${line}`)
      .join('\n')
    return `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
${before}      - name: Step
        run: |
${body}
`
  }
  const SHAPES = {
    'a line of its own': 'task=lintEnso\nsbt "$task"',
    'inline env assignments':
      'LC_ALL=C.UTF-8 SBT_SERVER_FORCESTART=true sbt "-Dbench.compileOnly=false" bench',
    'a quoted inline assignment': 'JAVA_OPTS="-Xmx4g -Xss16M" sbt compile',
    'after `cd x &&`': 'cd engine && sbt compile',
    'after `;`': 'cd engine; sbt compile',
    'after `then`': 'if true; then sbt compile; fi',
    'a command substitution': 'root=$(sbt -batch "print engineDistributionRoot")',
    'behind `timeout`': 'timeout -k 5 90m sbt compile',
    'behind `time` and `timeout`': 'time timeout 90m sbt compile',
    'behind `nice`': 'nice -n 10 sbt compile',
    'behind `env`': 'env -i PATH="$PATH" JAVA_OPTS=-Xmx4g sbt compile',
    'behind `xvfb-run`': 'xvfb-run -a -s "-screen 0 1280x1024x24" sbt test',
    'inside `bash -c`': "bash -lc 'cd engine && sbt compile'",
    'inside `pwsh -Command`': 'pwsh -Command "sbt compile"',
    '`sbt.bat` from PowerShell': '& sbt.bat "-Dsbt.server.autostart=false" compile',
    'behind `cmd /c`': 'cmd /c sbt compile',
    'by path': '"$SBT_HOME/bin/sbt" compile',
    'in backquotes': 'x=`sbt -batch about`',
    'in a group': '{ sbt compile; }',
    'as a condition': 'if sbt compile; then :; fi',
  }
  for (const [shape, script] of Object.entries(SHAPES)) {
    test(`accepts sbt after setup-jvm: ${shape}`, () => {
      const repo = fixture({ 'workflows/a.yml': job(script, SETUP) })
      assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [])
    })
    test(`rejects sbt with no setup-jvm before it: ${shape}`, () => {
      const repo = fixture({ 'workflows/a.yml': job(script) })
      assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
        'a.yml › j: `Step` runs sbt before `./.github/actions/setup-jvm`',
      ])
    })
  }
  test('accepts sbt as an argument rather than a command', () => {
    const script = [
      "some-tool sbt '--' verifyLicensePackages",
      'command -v sbt',
      'echo sbt',
      'env | grep sbt',
      'echo "use sbt.bat"',
      'curl -fsSL -o "$dir/sbt.tgz" "https://github.com/sbt/sbt/releases/download/v1/sbt-1.tgz"',
      'echo "$RUNNER_TEMP/sbt/bin" >> "$GITHUB_PATH"',
      'time some-tool get',
    ].join('\n')
    const repo = fixture({ 'workflows/a.yml': job(script) })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [])
  })
  test('rejects sbt with setup-jvm only after it', () => {
    const repo = fixture({
      'workflows/a.yml': `
on: push
jobs:
  late:
    runs-on: ubuntu-latest
    steps:
      - name: Lint
        run: sbt lintEnso
${SETUP}`,
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
      'a.yml › late: `Lint` runs sbt before `./.github/actions/setup-jvm`',
    ])
  })
  const action = (steps) => `name: A\nruns:\n  using: composite\n  steps:\n${steps}`
  const SBT_STEP = '    - name: Inner\n      shell: bash\n      run: LC_ALL=C.UTF-8 sbt compile\n'
  const ACTION_SETUP = '    - uses: ./.github/actions/setup-jvm\n      with: { cache-key: a }\n'
  const usesAction = (before = '') => `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
${before}      - name: Build
        uses: ./.github/actions/build-sbt
`
  test('accepts a composite action that calls sbt, used after setup-jvm', () => {
    const repo = fixture({
      'actions/build-sbt/action.yml': action(SBT_STEP),
      'workflows/a.yml': usesAction(SETUP),
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [])
  })
  test('accepts a composite action that sets up the JVM itself before calling sbt', () => {
    const repo = fixture({
      'actions/build-sbt/action.yml': action(ACTION_SETUP + SBT_STEP),
      'workflows/a.yml': usesAction(),
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [])
  })
  test('rejects a composite action that calls sbt, used with no setup-jvm before it', () => {
    const repo = fixture({
      'actions/build-sbt/action.yml': action(SBT_STEP),
      'workflows/a.yml': usesAction(),
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
      'a.yml › j: `Build` runs sbt before `./.github/actions/setup-jvm`',
    ])
  })
  test('rejects a composite action that calls sbt before its own setup-jvm', () => {
    const repo = fixture({
      'actions/build-sbt/action.yml': action(SBT_STEP + ACTION_SETUP),
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
      'actions/build-sbt: `Inner` runs sbt before `./.github/actions/setup-jvm`',
    ])
  })
})

describe('tools/build-scripts commands that start sbt', () => {
  /** A `tools/build-scripts` with one command that reaches `src/lib/sbt.ts` and one that does not. */
  const PACKAGE = {
    'tools/build-scripts/package.json': JSON.stringify({
      scripts: {
        'stdlib-test': 'node src/commands/stdlib-test.ts',
        version: 'node src/commands/version.ts',
        'test:unit': 'vitest run',
      },
    }),
    'tools/build-scripts/src/commands/stdlib-test.ts': "import { run } from '../stdlib-test/run.ts'\nrun()\n",
    'tools/build-scripts/src/stdlib-test/run.ts':
      "export { startHttpbin as run } from './services.ts'\n",
    'tools/build-scripts/src/stdlib-test/services.ts':
      "import { spawnSbt } from '../lib/sbt.ts'\nexport const startHttpbin = () => spawnSbt([])\n",
    'tools/build-scripts/src/lib/sbt.ts':
      "import { spawn } from 'node:child_process'\nimport { invocation } from './repo.ts'\n" +
      "export const spawnSbt = (a) => spawn('sbt', a)\nexport const how = (a) => invocation('sbt', a)\n",
    'tools/build-scripts/src/commands/version.ts': "import { x } from '../version/version.ts'\n",
    'tools/build-scripts/src/version/version.ts': 'export const x = 1\n',
  }
  const workflow = (before) => `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
${before}      - name: Tests
        run: corepack pnpm --filter build-scripts run stdlib-test -- standard-library
      - name: Version
        run: corepack pnpm --silent --filter build-scripts run version
`
  test('a command that imports src/lib/sbt.ts, however indirectly, starts sbt', () => {
    const repo = fixture({}, PACKAGE)
    assert.deepEqual([...buildScriptsSbtCommands(repo.buildScripts)], ['stdlib-test'])
    assert.equal(callsSbt('corepack pnpm --filter=build-scripts run stdlib-test', new Set(['stdlib-test'])), true)
    assert.equal(callsSbt('corepack pnpm -F build-scripts run version', new Set(['stdlib-test'])), false)
  })
  test('rejects such a command with no setup-jvm before it, accepts it after', () => {
    const late = fixture({ 'workflows/a.yml': workflow('') }, PACKAGE)
    assert.deepEqual(checkSbtRunsAfterSetupJvm(late), [
      'a.yml › j: `Tests` runs sbt before `./.github/actions/setup-jvm`',
    ])
    const setup = '      - uses: ./.github/actions/setup-jvm\n        with: { cache-key: a }\n'
    assert.deepEqual(checkSbtRunsAfterSetupJvm(fixture({ 'workflows/a.yml': workflow(setup) }, PACKAGE)), [])
  })
  test('only src/lib/sbt.ts may start sbt', () => {
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, PACKAGE)), [])
    const rogue = {
      ...PACKAGE,
      'tools/build-scripts/src/version/version.ts':
        "import { spawnSync } from 'node:child_process'\nspawnSync('sbt.bat', ['about'])\n",
    }
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, rogue)), [
      'tools/build-scripts/src/version/version.ts: starts sbt itself; use `src/lib/sbt.ts`, so the workflow policy sees it',
    ])
  })
  test("only src/lib/sbt.ts may start sbt through repo.ts' invocation", () => {
    const rogue = {
      ...PACKAGE,
      'tools/build-scripts/src/version/version.ts':
        "import { invocation } from '../lib/repo.ts'\nexport const how = invocation('sbt', ['about'])\n",
    }
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, rogue)), [
      'tools/build-scripts/src/version/version.ts: starts sbt itself; use `src/lib/sbt.ts`, so the workflow policy sees it',
    ])
    const unitTest = {
      ...PACKAGE,
      'tools/build-scripts/src/lib/repo.test.ts':
        "import { invocation } from './repo.ts'\ninvocation('sbt', ['about'])\n",
    }
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, unitTest)), [])
  })
  test('an entry point run with plain node starts sbt when it reaches src/lib/sbt.ts', () => {
    const entries = buildScriptsSbtEntries(fixture({}, PACKAGE).buildScripts)
    assert.equal(entries.has('src/commands/stdlib-test.ts'), true)
    assert.equal(entries.has('src/commands/version.ts'), false)
    const node = 'node tools/build-scripts/src/commands/stdlib-test.ts standard-library'
    assert.equal(callsSbt(node, new Set(), entries), true)
    assert.equal(callsSbt(`node --no-warnings ./${node}`, new Set(), entries), true)
    assert.equal(callsSbt('node tools/build-scripts/src/commands/version.ts', new Set(), entries), false)
  })
  test('rejects such a node step with no setup-jvm before it, accepts it after', () => {
    const plain = (before) => `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
${before}      - name: Tests
        run: node tools/build-scripts/src/commands/stdlib-test.ts standard-library
      - name: Version
        run: node tools/build-scripts/src/commands/version.ts
`
    assert.deepEqual(checkSbtRunsAfterSetupJvm(fixture({ 'workflows/a.yml': plain('') }, PACKAGE)), [
      'a.yml › j: `Tests` runs sbt before `./.github/actions/setup-jvm`',
    ])
    const setup = '      - uses: ./.github/actions/setup-jvm\n        with: { cache-key: a }\n'
    assert.deepEqual(checkSbtRunsAfterSetupJvm(fixture({ 'workflows/a.yml': plain(setup) }, PACKAGE)), [])
  })
  test('a repository without the package has no such commands', () => {
    assert.deepEqual([...buildScriptsSbtCommands(fixture({}).buildScripts)], [])
    assert.deepEqual([...buildScriptsSbtEntries(fixture({}).buildScripts)], [])
  })
})

const STDLIB_MAP_OK = `
everything: { libraries: [Base], stdBits: [] }
libraries:
  Base: { stdBits: [], dependsOn: [] }
  Table: { stdBits: [table], dependsOn: [Base] }
testProjects:
  Table_Tests: { imports: [Table], testImports: [Helpers] }
shards:
  - { name: Table, projects: [Table_Tests] }
  - { name: Others, projects: "*" }
`

/** A standard library with Base and Table, `std-bits/table` and `test/Table_Tests`. */
const STDLIB_FILES = {
  'distribution/lib/Standard/Base/0.0.0-dev/package.yaml': 'name: Base\n',
  'distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso': 'import Standard.Base.Any\n',
  'distribution/lib/Standard/Table/0.0.0-dev/package.yaml': 'name: Table\n',
  // The indented import is an example in a doc comment: it must not count.
  'distribution/lib/Standard/Table/0.0.0-dev/src/Main.enso':
    'from Standard.Base import all\n## Example\n    import Standard.Geo\n',
  'std-bits/table/README.md': '',
  'test/Table_Tests/package.yaml': 'name: Table_Tests\n',
  'test/Table_Tests/src/Main.enso':
    'from Standard.Table import all\nimport enso_dev.Helpers\nimport enso_dev.Table_Tests.Util\n',
}

const at = 'tools/ci/stdlib-test-map.yaml:'

describe('checkStdlibTestMap', () => {
  test('accepts a map that matches the repository', () => {
    const repo = fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': STDLIB_MAP_OK })
    assert.deepEqual(checkStdlibTestMap(repo), [])
  })
  test('accepts a repository without a standard library or a map', () => {
    assert.deepEqual(checkStdlibTestMap(fixture({})), [])
  })
  test('requires the map once there is a standard library', () => {
    assert.deepEqual(checkStdlibTestMap(fixture({}, STDLIB_FILES)), [
      `${at} missing (every library under distribution/lib/Standard needs an entry)`,
    ])
  })
  test('reports what the map lacks', () => {
    const repo = fixture(
      {},
      {
        ...STDLIB_FILES,
        'distribution/lib/Standard/Geo/0.0.0-dev/package.yaml': 'name: Geo\n',
        'distribution/lib/Standard/Geo/0.0.0-dev/src/Main.enso': 'from Standard.Table import all\n',
        'distribution/lib/Standard/Table/0.0.0-dev/src/Database.enso':
          'import Standard.Database.Connection\n',
        'std-bits/geo/README.md': '',
        'test/Geo_Tests/package.yaml': 'name: Geo_Tests\n',
        'test/Geo_Tests/src/Main.enso': 'from Standard.Geo import all\n',
        'tools/ci/stdlib-test-map.yaml': STDLIB_MAP_OK,
      },
    )
    assert.deepEqual(checkStdlibTestMap(repo), [
      `${at} no entry for library \`Geo\` (distribution/lib/Standard/Geo)`,
      `${at} \`libraries.Table.dependsOn\` lacks \`Database\`: distribution/lib/Standard/Table imports Standard.Database`,
      `${at} std-bits/geo belongs to no library (add it to a library's \`stdBits\` or to \`everything.stdBits\`)`,
      `${at} no entry for test project \`Geo_Tests\` (test/Geo_Tests)`,
    ])
  })
  test('reports stale entries and malformed shards', () => {
    const stale = `
everything: { libraries: [Base, Gone], stdBits: [] }
libraries:
  Base: { stdBits: [], dependsOn: [] }
  Table: { stdBits: [table, old], dependsOn: [Base] }
  Old: { stdBits: [], dependsOn: [] }
testProjects:
  Table_Tests: { imports: [Table], testImports: [Helpers] }
  Old_Tests: { imports: [], testImports: [] }
shards:
  - { name: Table, projects: [Table_Tests, Nope_Tests] }
  - { name: Again, projects: [Table_Tests] }
  - { name: Rest, projects: [Table_Tests] }
`
    const repo = fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': stale })
    assert.deepEqual(checkStdlibTestMap(repo), [
      `${at} \`libraries.Old\` names no directory under distribution/lib/Standard`,
      `${at} std-bits/old is listed but does not exist`,
      `${at} \`testProjects.Old_Tests\` names no test project under test/`,
      `${at} \`everything.libraries\` names \`Gone\`, which is not a library`,
      `${at} the last shard must have \`projects: "*"\` (the projects no other shard names)`,
      `${at} shard \`Table\` names \`Nope_Tests\`, which is not a test project`,
      `${at} shard \`Again\` names \`Table_Tests\`, which shard \`Table\` already runs`,
    ])
  })
})

describe('checkStdlibTestMap: a shard that needs a database', () => {
  test('accepts a shard that needs postgres, and rejects another database or a "*" shard with needs', () => {
    const map = (shards) => STDLIB_MAP_OK.replace(/^shards:[\s\S]*$/m, `shards:\n${shards}`)
    const ok =
      '  - { name: Table, projects: [Table_Tests], needs: postgres }\n  - { name: Others, projects: "*" }\n'
    assert.deepEqual(
      checkStdlibTestMap(fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': map(ok) })),
      [],
    )
    const bad =
      '  - { name: Table, projects: [Table_Tests], needs: mysql }\n  - { name: Others, projects: "*", needs: postgres }\n'
    assert.deepEqual(
      checkStdlibTestMap(
        fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': map(bad) }),
      ),
      [
        `${at} shard \`Table\` has \`needs: mysql\`; only \`postgres\` is known`,
        `${at} the "*" shard cannot have \`needs\` (its projects would run nowhere)`,
      ],
    )
  })
})

describe('checkStdlibTestMap: a split shard', () => {
  const withShards = (shards) =>
    fixture(
      {},
      {
        ...STDLIB_FILES,
        'tools/ci/stdlib-test-map.yaml': STDLIB_MAP_OK.replace(
          /shards:[\s\S]*$/,
          `shards:\n${shards}\n  - { name: Others, projects: "*" }\n`,
        ),
      },
    )
  const good = `  - name: Table
    projects: [Table_Tests]
    split:
      - { name: PostgreSQL, groups: 'a', needs: postgres }
      - { name: Rest }`
  test('accepts one project, a last part without groups, and a known need', () => {
    assert.deepEqual(checkStdlibTestMap(withShards(good)), [])
  })
  test('rejects a split of more than one project', () => {
    const repo = withShards(good.replace('[Table_Tests]', '[Table_Tests, Base_Tests]'))
    assert.ok(
      checkStdlibTestMap(repo).some((p) => p.includes('does not name exactly one project')),
    )
  })
  test('rejects a split that does not end in one part without groups', () => {
    const noRest = good.replace('      - { name: Rest }', "      - { name: B, groups: 'b' }")
    const twoRests = good.replace("groups: 'a', ", '')
    for (const shards of [noRest, twoRests]) {
      assert.ok(checkStdlibTestMap(withShards(shards)).some((p) => p.includes('must end in exactly one part')))
    }
  })
  test('rejects a need other than postgres', () => {
    const repo = withShards(good.replace('needs: postgres', 'needs: mssql'))
    assert.ok(checkStdlibTestMap(repo).some((p) => p.includes('only `postgres` is known')))
  })
})

test('the repository follows the policy', () => {
  assert.deepEqual(checkRepo(repoRoot), [])
})

test('checkSetupNodeCache fails when it finds nothing to check', () => {
  const repo = fixture({ 'workflows/a.yml': 'on: push\njobs: {}\n' })
  assert.equal(checkSetupNodeCache(repo).length, 1)
})

describe('checkWasmBindgenPins', () => {
  const source = {
    'app/rust-ffi/build-wasm.mjs': "const WASM_BINDGEN_VERSION = '0.2.128'\n",
  }
  const install = (version) =>
    `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: taiki-e/install-action@v2\n        with:\n          tool: wasm-bindgen-cli@${version}\n`
  test('accepts installs at the pinned version', () => {
    assert.deepEqual(
      checkWasmBindgenPins(fixture({ 'workflows/a.yml': install('0.2.128') }, source)),
      [],
    )
  })
  test('rejects an install at another version', () => {
    assert.deepEqual(
      checkWasmBindgenPins(fixture({ 'workflows/a.yml': install('0.2.127') }, source)),
      ['a.yml: installs wasm-bindgen-cli@0.2.127, but app/rust-ffi/build-wasm.mjs pins 0.2.128'],
    )
  })
})

describe('exportedTypes', () => {
  test('reads exports, aliases and lists, skipping functions and examples', () => {
    assert.deepEqual(
      exportedTypes(
        [
          'export project.DuckDB.DuckDB',
          'export project.Table_Extensions.geo_distance',
          'export project.S3.S3_File as File_On_S3',
          'from project.Image export Image, Matrix',
          '## Example',
          '    export project.Not.Counted',
          '',
        ].join('\n'),
      ),
      ['DuckDB', 'File_On_S3', 'Image', 'Matrix'],
    )
  })
})

describe('unreadableExports', () => {
  test('accepts the forms exportedTypes reads', () => {
    assert.deepEqual(
      unreadableExports(
        [
          'export project.DuckDB.DuckDB',
          'export project.S3.S3_File as File_On_S3',
          'from project.Image export Image, Matrix',
          '## Example',
          '    export project.Not.Counted',
          '',
        ].join('\n'),
      ),
      [],
    )
  })
  test('rejects `export all`, a split list and any other export', () => {
    assert.deepEqual(
      unreadableExports(
        [
          'from project.Geo export all',
          'from project.Image export Image,',
          '    Matrix',
          'from project.Image export Image',
          '    , Matrix',
          'from project.Image export all hiding Matrix',
          'export project.Geo.Geo hiding x',
        ].join('\n'),
      ),
      [
        '1: `export all` (list the exported names)',
        '2: an export list split over several lines (keep it on one line)',
        '4: an export list split over several lines (keep it on one line)',
        '6: `export all` (list the exported names)',
        '7: an export the check cannot read',
      ],
    )
  })
})

describe('checkPublicTypes', () => {
  const lib = (yaml, main) => ({
    'distribution/lib/Standard/Base/0.0.0-dev/package.yaml': 'name: Base\n',
    'distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso': 'export project.Any.Any\n',
    'distribution/lib/Standard/Geo/0.0.0-dev/package.yaml': yaml,
    'distribution/lib/Standard/Geo/0.0.0-dev/src/Main.enso': main,
  })
  const main = 'export project.Geo.Geo\nexport project.Table_Extensions.geo_distance\n'
  const at = 'distribution/lib/Standard/Geo/0.0.0-dev/package.yaml:'

  test('accepts a matching declaration, and ignores the core set', () => {
    assert.deepEqual(
      checkPublicTypes(fixture({}, lib('name: Geo\npublic-types: [Geo]\n', main))),
      [],
    )
  })
  test('requires the declaration outside the core set', () => {
    assert.deepEqual(checkPublicTypes(fixture({}, lib('name: Geo\n', main))), [
      `${at} no \`public-types:\` list (its Main.enso exports [Geo])`,
    ])
  })
  test('reports a declaration that differs from the exports', () => {
    assert.deepEqual(
      checkPublicTypes(fixture({}, lib('name: Geo\npublic-types: [Geo, Old]\n', main))),
      [`${at} \`public-types\` is [Geo, Old] but Main.enso exports [Geo]`],
    )
  })
  test('reports an export of Main.enso it cannot read', () => {
    assert.deepEqual(
      checkPublicTypes(
        fixture({}, lib('name: Geo\npublic-types: [Geo]\n', main + 'from project.X export all\n')),
      ),
      ['distribution/lib/Standard/Geo/0.0.0-dev/src/Main.enso:3: `export all` (list the exported names)'],
    )
  })
})

describe('checkSuiteIgnoresBackendNames', () => {
  const at = 'distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src/X_Spec.enso'
  const repo = (code) => fixture({}, { [at]: code })
  const why =
    "decides by the backend's name; ask the setup (`flagged`, `is_feature_supported`, `is_operation_supported`, `is_aggregate_supported`) or list a `Known_Issue`"

  test('accepts the prefix used as a name, questions to the setup, comments, docs and text', () => {
    const code = [
      '## Adds a group with the given `prefix` as its name prefix.',
      '   The prefix. is prose here, in a doc block.',
      'add_specs suite_builder prefix setup =',
      '    prefix_text = setup.prefix',
      '    suite_builder.group prefix+"Table.aggregate" group_builder->',
      '    # Snowflake once needed setup.prefix.contains "Snowflake" here.',
      '    if setup.flagged ..Date_Time then group_builder.specify "x" <| 1',
      '    group_builder.specify "reads the prefix. of a name" <| 1',
      '    in_file_prefix = "[SQLite File] "',
    ].join('\n')
    assert.deepEqual(checkSuiteIgnoresBackendNames(repo(code)), [])
  })
  test('rejects a test of the prefix, the group name, the dialect name and the backend name', () => {
    const code = [
      '    if setup.prefix.contains "SQLite" then 1',
      '    if prefix == "[SQLite] " then 1',
      '    if group_builder.name.contains "Snowflake" then 1',
      '    if t.dialect_name != "DuckDB" then 1',
      '    n = backend.name',
    ].join('\n')
    assert.deepEqual(
      checkSuiteIgnoresBackendNames(repo(code)),
      [1, 2, 3, 4, 5].map((line) => `${at}:${line}: ${why}`),
    )
  })
  test('checks the code after a doc block ends', () => {
    const code = ['## A spec.', '   More prose.', 'x = if prefix == "a" then 1'].join('\n')
    assert.deepEqual(checkSuiteIgnoresBackendNames(repo(code)), [`${at}:3: ${why}`])
  })
  test('looks only at the suite', () => {
    const other = 'distribution/lib/Standard/Table/0.0.0-dev/src/X.enso'
    assert.deepEqual(
      checkSuiteIgnoresBackendNames(fixture({}, { [other]: 'if prefix == "x" then 1\n' })),
      [],
    )
  })
})

describe('checkStdlibTestsGetTheGroupFilter', () => {
  const job = (env, args) => `on: workflow_call
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - name: Run the Standard Library tests
        run: corepack pnpm --filter build-scripts run stdlib-test \${{ matrix.suite }}${args}
${env}`
  const only = ' --only "\${{ matrix.only }}"'
  const filter = "        env:\n          ENSO_TEST_GROUP_FILTER: ${{ matrix.group-filter || '' }}"
  test('accepts a plan job that passes the filter, and a suite run with no plan', () => {
    const repo = fixture({
      'workflows/a.yml': job(filter, only),
      'workflows/extra-nightly-tests.yml': job('', ''),
    })
    assert.deepEqual(checkStdlibTestsGetTheGroupFilter(repo), [])
  })
  test('rejects a plan job without the filter, or with another value', () => {
    const repo = fixture({
      'workflows/a.yml': job('', only),
      'workflows/b.yml': job('        env:\n          ENSO_TEST_GROUP_FILTER: x', only),
    })
    assert.equal(checkStdlibTestsGetTheGroupFilter(repo).length, 2)
  })
})

describe('globMatches and pathsMatch', () => {
  test('* stays within a directory, ** crosses them, ? is one character', () => {
    assert.equal(globMatches('docs/*', 'docs/a.md'), true)
    assert.equal(globMatches('docs/*', 'docs/superpowers/a.md'), false)
    assert.equal(globMatches('docs/**', 'docs/superpowers/specs/a.md'), true)
    assert.equal(globMatches('**/*.md', 'docs/superpowers/a.md'), true)
    assert.equal(globMatches('**/*.md', 'a.md'), true)
    assert.equal(globMatches('*', 'docs/a.md'), false)
    assert.equal(globMatches('**', 'docs/a.md'), true)
    assert.equal(globMatches('docs/a?.md', 'docs/.md'), true)
    assert.equal(globMatches('docs/a?.md', 'docs/a.md'), true)
    assert.equal(globMatches('docs/a?.md', 'docs/aa.md'), false)
    assert.equal(globMatches('engine/**', 'docs/a.md'), false)
  })
  test('+ is one or more of the preceding character, [] a character class, braces literal', () => {
    assert.equal(globMatches('docs/a+.md', 'docs/a.md'), true)
    assert.equal(globMatches('docs/a+.md', 'docs/aaa.md'), true)
    assert.equal(globMatches('docs/a+.md', 'docs/.md'), false)
    assert.equal(globMatches('docs/[ab].md', 'docs/b.md'), true)
    assert.equal(globMatches('docs/[a-c].md', 'docs/c.md'), true)
    assert.equal(globMatches('docs/[a-c].md', 'docs/d.md'), false)
    assert.equal(globMatches('docs/{a,b}.md', 'docs/a.md'), false)
    assert.equal(globMatches('docs/{a,b}.md', 'docs/{a,b}.md'), true)
  })
  test('an unclosed [ or a stray quantifier is literal and never throws', () => {
    assert.equal(globMatches('docs/[a.md', 'docs/[a.md'), true)
    assert.equal(globMatches('docs/[a.md', 'docs/a.md'), false)
    assert.equal(globMatches('docs/[]a', 'docs/[]a'), true)
    assert.equal(globMatches('+a', '+a'), true)
    assert.equal(globMatches('docs/(a', 'docs/(a'), true)
  })
  test('a later ! pattern excludes what an earlier one included', () => {
    assert.equal(pathsMatch(['docs/**', '!docs/superpowers/**'], 'docs/superpowers/a.md'), false)
    assert.equal(pathsMatch(['docs/**', '!docs/superpowers/**'], 'docs/other.md'), true)
    assert.equal(pathsMatch(['!docs/superpowers/**', 'docs/**'], 'docs/superpowers/a.md'), true)
  })
})

describe('checkPullRequestsIgnoreSpecs: real glob matching', () => {
  const on = (filter) =>
    fixture({ 'workflows/a.yml': `on:\n  pull_request:\n${filter}\njobs: {}\n` })
  test('rejects a whitelist whose glob matches the specs', () => {
    assert.equal(checkPullRequestsIgnoreSpecs(on('    paths: ["**"]')).length, 1)
    assert.equal(checkPullRequestsIgnoreSpecs(on('    paths: ["**/*.md"]')).length, 1)
    assert.equal(checkPullRequestsIgnoreSpecs(on('    paths: ["docs/**"]')).length, 1)
    assert.equal(
      checkPullRequestsIgnoreSpecs(on('    paths: ["engine/**", "docs/superpowers/**"]')).length,
      1,
    )
  })
  test('accepts a whitelist that leaves the specs out', () => {
    assert.deepEqual(checkPullRequestsIgnoreSpecs(on('    paths: ["*", "engine/**"]')), [])
    assert.deepEqual(
      checkPullRequestsIgnoreSpecs(on('    paths: ["docs/**", "!docs/superpowers/**"]')),
      [],
    )
  })
  test('accepts a paths-ignore whose glob covers the specs, rejects one that does not', () => {
    assert.deepEqual(checkPullRequestsIgnoreSpecs(on('    paths-ignore: ["docs/**"]')), [])
    assert.equal(checkPullRequestsIgnoreSpecs(on('    paths-ignore: ["docs/*"]')).length, 1)
    assert.equal(checkPullRequestsIgnoreSpecs(on('    paths-ignore: ["**.txt"]')).length, 1)
  })
})

describe('checkLocalActionsFollowCheckout', () => {
  const job = (steps) => `on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
  const CHECKOUT = '      - uses: actions/checkout@v5\n'
  const LOCAL = '      - name: Set up\n        uses: ./.github/actions/setup-jvm\n'
  test('accepts a local action after the checkout, and a job with no local action', () => {
    const repo = fixture({
      'workflows/a.yml': job(CHECKOUT + LOCAL),
      'workflows/b.yml': job('      - run: echo hi\n'),
    })
    assert.deepEqual(checkLocalActionsFollowCheckout(repo), [])
  })
  test('rejects a local action before the checkout, or with none', () => {
    const repo = fixture({
      'workflows/a.yml': job(LOCAL + CHECKOUT),
      'workflows/b.yml': job(LOCAL),
    })
    assert.deepEqual(checkLocalActionsFollowCheckout(repo), [
      'a.yml › j: `Set up` uses a local action before `actions/checkout` (the action is not on the runner until then)',
      'b.yml › j: `Set up` uses a local action before `actions/checkout` (the action is not on the runner until then)',
    ])
  })
})

describe('checkCleanAfterAlwaysRuns', () => {
  const job = (steps) => `on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
  const CLEAN = (name, cond = '') =>
    `      - name: ${name}\n${cond}        uses: ./.github/actions/git-clean\n`
  test('accepts a "Clean after" with if: always(), and an unconditional "Clean before"', () => {
    const repo = fixture({
      'workflows/a.yml': job(
        CLEAN('Clean before') + CLEAN('Clean after', '        if: always()\n'),
      ),
      'workflows/b.yml': job(CLEAN('Clean after', '        if: always() && inputs.x\n')),
    })
    assert.deepEqual(checkCleanAfterAlwaysRuns(repo), [])
  })
  test('rejects a "Clean after" that a failed job would skip', () => {
    const repo = fixture({
      'workflows/a.yml': job(CLEAN('Clean before') + CLEAN('Clean after')),
      'workflows/b.yml': job(CLEAN('Clean after', '        if: success()\n')),
      'workflows/c.yml': job(CLEAN('Clean after', '        if: ${{ !cancelled() }}\n')),
    })
    const problems = checkCleanAfterAlwaysRuns(repo)
    assert.equal(problems.length, 3)
    assert.match(problems[0], /^a\.yml › j: `Clean after` .*`if: always\(\)`/)
  })
  test('rejects a later git-clean call that is not named "Clean after"', () => {
    const repo = fixture({
      'workflows/a.yml': job(CLEAN('Clean before') + CLEAN('Tidy up')),
    })
    assert.equal(checkCleanAfterAlwaysRuns(repo).length, 1)
  })
})

describe('checkCleanBuildVariableIsDefined', () => {
  const wf = (env, jobEnv = '') =>
    `on: push\n${env}jobs:\n  j:\n    runs-on: ubuntu-latest\n${jobEnv}    steps:\n      - uses: ./.github/actions/git-clean\n`
  test('accepts a string at the top of the workflow, or on the job', () => {
    const repo = fixture({
      'workflows/a.yml': wf('env:\n  ENSO_CI_CLEAN_BUILD: "true"\n'),
      'workflows/b.yml': wf(
        'env:\n  ENSO_CI_CLEAN_BUILD: "${{ github.ref == \'refs/heads/develop\' }}"\n',
      ),
      'workflows/c.yml': wf('', '    env:\n      ENSO_CI_CLEAN_BUILD: "false"\n'),
      'workflows/d.yml': 'on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps: []\n',
    })
    assert.deepEqual(checkCleanBuildVariableIsDefined(repo), [])
  })
  test('rejects a workflow that never defines it, or defines a boolean', () => {
    const repo = fixture({
      'workflows/a.yml': wf(''),
      'workflows/b.yml': wf('env:\n  ENSO_CI_CLEAN_BUILD: true\n'),
    })
    assert.deepEqual(checkCleanBuildVariableIsDefined(repo), [
      'a.yml › j: uses `git-clean` but defines no `ENSO_CI_CLEAN_BUILD` (at the top of the workflow or on the job)',
      'b.yml › j: `ENSO_CI_CLEAN_BUILD` must be a string (`"true"`), not true',
    ])
  })
})

describe('macOS rules with a matrix runs-on', () => {
  const MATRIX_MAC = `    strategy:
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
          - os: macos
            runner: macos-latest
`
  const releaseWithMatrixMac = RELEASE_OK.replace(
    '  upload-ide-macos:',
    `  matrix-mac:
    needs: [check-the-mac-os-runner]
    runs-on: \${{ matrix.runner }}
${MATRIX_MAC}    steps: []
  upload-ide-macos:`,
  )
  test('a matrix job with a macOS leg counts as a macOS job (unexpected here)', () => {
    const repo = fixture({ 'workflows/release.yml': releaseWithMatrixMac })
    assert.ok(
      checkMacosReleaseJobsAreRequired(repo).some((p) =>
        p.includes('matrix-mac: unexpected macOS job'),
      ),
    )
  })
  test('a matrix macOS job must be gated on the Mac', () => {
    const repo = fixture({ 'workflows/release.yml': releaseWithMatrixMac })
    assert.ok(
      checkMacosJobsAreGated(repo).some((p) =>
        p.includes('release.yml › matrix-mac: a macOS job must need'),
      ),
    )
  })
  test('a call with os from the matrix must be gated when a leg is macos', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner:
    runs-on: ubuntu-latest
    steps: []
  platform:
    strategy:
      matrix:
        include:
          - os: linux
          - os: macos
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: \${{ matrix.os }}
`,
    })
    assert.ok(
      checkMacosJobsAreGated(repo).some((p) =>
        p.includes('engine-checks-nightly.yml › platform: a macOS job must need'),
      ),
    )
  })
  test('a matrix with only Linux and Windows legs is not a macOS job', () => {
    const repo = fixture({
      'workflows/release.yml': RELEASE_OK.replace(
        '  upload-ide:\n    runs-on: ubuntu-latest',
        '  upload-ide:\n    runs-on: ${{ matrix.runner }}\n    strategy:\n      matrix:\n        runner: [ubuntu-latest, windows-latest]',
      ),
    })
    assert.deepEqual(checkMacosReleaseJobsAreRequired(repo), [])
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  describe('checkRunsOnResolvesAgainstItsMatrix', () => {
    const job = (runsOn, strategy = '') =>
      `on: push\njobs:\n  j:\n    runs-on: ${runsOn}\n${strategy}    steps: []\n`
    test('accepts literals, inputs and a matrix key every leg defines', () => {
      const repo = fixture({
        'workflows/a.yml': job('ubuntu-latest'),
        'workflows/b.yml': job('${{ inputs.runner }}'),
        'workflows/c.yml': job('${{ matrix.runner }}', MATRIX_MAC),
        'workflows/d.yml': job(
          '${{ matrix.runner }}',
          '    strategy:\n      matrix:\n        runner: [ubuntu-latest, windows-latest]\n',
        ),
      })
      assert.deepEqual(checkRunsOnResolvesAgainstItsMatrix(repo), [])
    })
    test('rejects a matrix expression its strategy does not define, or computes', () => {
      const repo = fixture({
        'workflows/a.yml': job('${{ matrix.runner }}'),
        'workflows/b.yml': job(
          '${{ matrix.runner }}',
          '    strategy:\n      matrix:\n        os: [linux]\n',
        ),
        'workflows/c.yml': job(
          '${{ matrix.runner }}',
          '    strategy:\n      matrix: ${{ fromJSON(inputs.m) }}\n',
        ),
        'workflows/d.yml': job(
          '${{ matrix.runner }}',
          '    strategy:\n      matrix:\n        include:\n          - os: linux\n            runner: ubuntu-latest\n          - os: macos\n',
        ),
      })
      const problems = checkRunsOnResolvesAgainstItsMatrix(repo)
      assert.equal(problems.length, 4)
      assert.match(problems[0], /^a\.yml › j: `runs-on` reads `matrix\.runner`/)
    })
  })
})

describe('checkSbtRunsAfterSetupJvm: a conditional setup-jvm', () => {
  const wf = (setupIf, sbtIf) => `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - ${setupIf}uses: ./.github/actions/setup-jvm
        with: { cache-key: a }
      - name: Build
        ${sbtIf}run: sbt compile
`
  test('rejects sbt after a setup-jvm that may be skipped', () => {
    const repo = fixture({ 'workflows/a.yml': wf('if: inputs.build\n        ', '') })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
      'a.yml › j: `Build` runs sbt before `./.github/actions/setup-jvm`',
    ])
  })
  test('accepts sbt under the same condition as the setup-jvm, or an unconditional one', () => {
    const same = fixture({
      'workflows/a.yml': wf('if: inputs.build\n        ', 'if: inputs.build\n        '),
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(same), [])
    const plain = fixture({ 'workflows/a.yml': wf('', '') })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(plain), [])
  })
})
