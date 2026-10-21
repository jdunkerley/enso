// Run with `node --test tools/ci/check-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkIdePackagingNeedsNoCloudAccount,
  checkMacosChecksRunWhatIsRequested,
  checkMacosJobsAreGated,
  checkOnlyMacosReleaseJobsMayFail,
  checkPullRequestsIgnoreSpecs,
  checkReleaseIsIdeOnly,
  checkRepo,
  checkSetupNodeCache,
  checkToolchainPins,
  checkWindowsInstallerSmokeTest,
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

const RELEASE_OK = `
name: Release
on: workflow_dispatch
env:
  ENSO_BUILD_UPDATE_INFO: "true"
jobs:
  draft:
    runs-on: ubuntu-latest
    steps:
      - run: ./run release create-draft && ./run release publish
      - run: ./run release update-latest-version && ./run ide upload
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
  check-the-mac-os-runner:
    runs-on: ubuntu-latest
    steps: []
  build-script-macos-aarch64:
    needs: [check-the-mac-os-runner]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    runs-on: [self-hosted, macOS]
    steps: []
  enso-build-ci-gen-job-build-backend-macos-aarch64:
    needs: [check-the-mac-os-runner, build-script-macos-aarch64]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    steps: []
  enso-build-ci-gen-upload-ide-macos-aarch64:
    needs: [check-the-mac-os-runner]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    steps: []
  enso-build-ci-gen-publish-release-linux-amd64:
    runs-on: ubuntu-latest
    needs: [enso-build-ci-gen-upload-ide-macos-aarch64]
    if: always() && needs.upload-ide-linux-amd64.result == 'success' && needs.upload-ide-windows-amd64.result == 'success' && needs.draft-release.result == 'success'
    steps: []
`

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
  test('rejects cloud steps and cloud secrets', () => {
    const text = RELEASE_OK.replace(
      './run ide upload',
      './run ide upload --backend-source release',
    ).replace('secrets.GITHUB_TOKEN', 'secrets.CI_PRIVATE_TOKEN')
    const problems = checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': text }))
    assert.ok(problems.some((p) => p.includes('--backend-source release')))
    assert.ok(problems.some((p) => p.includes('reads secret `CI_PRIVATE_TOKEN`')))
  })
})

describe('checkOnlyMacosReleaseJobsMayFail', () => {
  test('accepts a tolerant macOS upload', () => {
    assert.deepEqual(
      checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': RELEASE_OK })),
      [],
    )
  })
  test('rejects a tolerant Linux job and a blocking macOS upload', () => {
    const text = RELEASE_OK.replace('continue-on-error: true', 'continue-on-error: false').replace(
      '  draft:\n    runs-on: ubuntu-latest',
      '  draft:\n    runs-on: ubuntu-latest\n    continue-on-error: true',
    )
    assert.equal(
      checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text })).length,
      2,
    )
  })
})

const MACOS_UPLOAD = 'enso-build-ci-gen-upload-ide-macos-aarch64'
const PUBLISH = 'enso-build-ci-gen-publish-release-linux-amd64'
const GATE_IF = "if: needs.check-the-mac-os-runner.outputs.online == 'true'"

describe('checkMacosJobsAreGated', () => {
  const problems = (text) =>
    checkMacosJobsAreGated(fixture({ 'workflows/release.yml': text }))
  test('accepts a gated release whose publish job does not wait on macOS', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('accepts a gated nightly', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  build-script-macos-aarch64: { needs: [check-the-mac-os-runner], ${GATE_IF}, runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  test('rejects an ungated macOS job in the nightly, and a nightly without its macOS script job', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  tests-macos: { runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    const found = checkMacosJobsAreGated(repo)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('tests-macos')))
    assert.ok(found.some((p) => p.includes('build-script-macos-aarch64')))
  })
  test('rejects macOS jobs when the gate job is missing', () => {
    const text = RELEASE_OK.replace(
      '  check-the-mac-os-runner:\n    runs-on: ubuntu-latest\n    steps: []\n',
      '',
    )
    assert.ok(problems(text).some((p) => p.includes('no `check-the-mac-os-runner` gate job')))
  })
  test('rejects an ungated macOS job in the release', () => {
    const text = RELEASE_OK.replace(
      `    needs: [check-the-mac-os-runner, build-script-macos-aarch64]\n    ${GATE_IF}\n`,
      '    needs: [build-script-macos-aarch64]\n',
    )
    assert.ok(problems(text).some((p) => p.includes('build-backend-macos-aarch64')))
  })
  test('rejects a release with no publish job', () => {
    const text = RELEASE_OK.replace(PUBLISH, 'something-else')
    assert.ok(problems(text).some((p) => p.includes('no publish job')))
  })
  test('rejects a publish job that no longer needs the macOS upload', () => {
    const text = RELEASE_OK.replace(`needs: [${MACOS_UPLOAD}]`, 'needs: []')
    assert.ok(problems(text).some((p) => p.includes('must still need the macOS IDE upload')))
  })
  test('rejects a publish job that waits on macOS, and one that drops the Windows upload', () => {
    const waits = problems(
      RELEASE_OK.replace('always() &&', "always() && needs.upload-ide-macos.result == 'success' &&"),
    )
    assert.ok(waits.some((p) => p.includes('must not wait on a macOS job')))
    const drops = problems(
      RELEASE_OK.replace(" && needs.upload-ide-windows-amd64.result == 'success'", ''),
    )
    assert.ok(drops.some((p) => p.includes('lacks upload-ide-windows-amd64')))
  })
})

describe('checkOnlyMacosReleaseJobsMayFail, macOS jobs', () => {
  const problems = (text) =>
    checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text }))
  test('rejects a release without its macOS IDE upload job', () => {
    const found = problems(RELEASE_OK.replace(MACOS_UPLOAD + ':', 'something-else:'))
    assert.ok(found.some((p) => p.includes('no macOS IDE upload job')))
    assert.ok(found.some((p) => p.includes(`has no macOS job \`${MACOS_UPLOAD}\``)))
  })
  test('rejects a macOS job that is not one of the release jobs', () => {
    const found = problems(RELEASE_OK.replace('build-script-macos-aarch64:', 'build-script-mac:'))
    assert.ok(found.some((p) => p.includes('unexpected macOS job')))
  })
})

describe('checkMacosChecksRunWhatIsRequested', () => {
  const job = (condition) =>
    `{ runs-on: [self-hosted, macOS], ${condition ? `if: ${condition}, ` : ''}steps: [] }`
  const checks = (engineIf, libraries) => `
on: workflow_call
jobs:
  build-engine-distribution: ${job()}
  jvm-tests: ${job(engineIf)}
${libraries.map((id) => `  ${id}: ${job('inputs.libraries')}`).join('\n')}
`
  test('accepts one engine job and three library jobs', () => {
    const repo = fixture({ 'workflows/macos-checks.yml': checks('inputs.engine', ['a', 'b', 'c']) })
    assert.deepEqual(checkMacosChecksRunWhatIsRequested(repo), [])
  })
  test('applies only once macos-checks.yml exists', () => {
    assert.deepEqual(checkMacosChecksRunWhatIsRequested(fixture({})), [])
  })
  test('rejects a missing library job and an unrelated engine condition', () => {
    const repo = fixture({ 'workflows/macos-checks.yml': checks('inputs.other', ['a', 'b']) })
    assert.equal(checkMacosChecksRunWhatIsRequested(repo).length, 2)
  })
  test('rejects a gated engine distribution, and one that is missing', () => {
    const good = checks('inputs.engine', ['a', 'b', 'c'])
    const gated = good.replace(
      'build-engine-distribution: { runs-on',
      'build-engine-distribution: { if: inputs.engine, runs-on',
    )
    const found = checkMacosChecksRunWhatIsRequested(
      fixture({ 'workflows/macos-checks.yml': gated }),
    )
    assert.ok(found.some((p) => p.includes('must always be built')))
    const missing = good.replace('build-engine-distribution:', 'build-something:')
    assert.deepEqual(
      checkMacosChecksRunWhatIsRequested(fixture({ 'workflows/macos-checks.yml': missing })),
      ['macos-checks.yml: has no engine distribution job'],
    )
  })
  test('rejects a job that does not run on macOS', () => {
    const text = checks('inputs.engine', ['a', 'b', 'c']).replace(
      'a: { runs-on: [self-hosted, macOS]',
      'a: { runs-on: ubuntu-latest',
    )
    const found = checkMacosChecksRunWhatIsRequested(fixture({ 'workflows/macos-checks.yml': text }))
    assert.equal(found.length, 1)
    assert.match(found[0], /a: must run on macOS/)
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

describe('checkToolchainPins', () => {
  const build = {
    'project/Dependencies.scala':
      'object Dependencies {\n  val graalVersion = "25.0.1"\n  val flatbuffersVersion      = "24.3.25"\n}\n',
    'project/build.properties': '# HELD at 1.10.6.\r\nsbt.version=1.10.6\r\n',
  }
  const config = (pins) => `latest-release: 2025.3.4\ntoolchain:\n${pins}`
  const allPins = '  graalvm: 25.0.1\n  sbt: 1.10.6 # held\n  flatc: 24.3.25\n'
  test("accepts pins equal to the build's own copies", () => {
    const repo = fixture({}, { 'build-config.yaml': config(allPins), ...build })
    assert.deepEqual(checkToolchainPins(repo), [])
  })
  test('rejects a pin that drifted, and a missing pin', () => {
    const pins = '  graalvm: 25.0.2\n  sbt: 1.10.6\n'
    const problems = checkToolchainPins(fixture({}, { 'build-config.yaml': config(pins), ...build }))
    assert.deepEqual(problems.sort(), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.2, but project/Dependencies.scala has 25.0.1',
      'build-config.yaml: no `toolchain.flatc` pin',
    ])
  })
  test('rejects a build file without the version, and a missing build-config.yaml', () => {
    const repo = fixture(
      {},
      {
        'build-config.yaml': config(allPins),
        'project/Dependencies.scala': build['project/Dependencies.scala'],
      },
    )
    assert.deepEqual(checkToolchainPins(repo), ['project/build.properties: no sbt version found'])
    assert.deepEqual(checkToolchainPins(fixture({})), ['build-config.yaml: missing'])
  })
})

test('the repository follows the policy', () => {
  assert.deepEqual(checkRepo(repoRoot), [])
})

test('checkSetupNodeCache fails when it finds nothing to check', () => {
  const repo = fixture({ 'workflows/a.yml': 'on: push\njobs: {}\n' })
  assert.equal(checkSetupNodeCache(repo).length, 1)
})
