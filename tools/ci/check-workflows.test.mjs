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
  checkWindowsInstallerSmokeTest,
  loadRepo,
} from './check-workflows.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'check-workflows-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

let fixtureCount = 0
/** A repository holding only the given `.github` files (paths relative to `.github`). */
function fixture(files) {
  const root = path.join(scratch, `repo-${fixtureCount++}`)
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, '.github', file)
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
  enso-build-ci-gen-upload-ide-macos-aarch64:
    runs-on: [macos-latest]
    continue-on-error: true
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

describe('checkMacosJobsAreGated', () => {
  test('applies only once the gate job exists', () => {
    assert.deepEqual(checkMacosJobsAreGated(fixture({ 'workflows/release.yml': RELEASE_OK })), [])
  })
  test('rejects an ungated macOS job', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  tests-macos: { runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    assert.equal(checkMacosJobsAreGated(repo).length, 1)
  })
})

const PUBLISH_GATED = `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  upload-ide-macos: { needs: [check-the-mac-os-runner], if: needs.check-the-mac-os-runner.outputs.online == 'true', runs-on: [self-hosted, macOS], steps: [] }
  publish-release:
    runs-on: ubuntu-latest
    needs: [upload-ide-macos]
    if: always() && needs.upload-ide-linux-amd64.result == 'success' && needs.upload-ide-windows-amd64.result == 'success' && needs.draft-release.result == 'success'
    steps: []
`

describe('checkMacosJobsAreGated, publishing', () => {
  const run = (text) => checkMacosJobsAreGated(fixture({ 'workflows/release.yml': text }))
  test('accepts a publish job that needs the macOS upload but does not wait on it', () => {
    assert.deepEqual(run(PUBLISH_GATED), [])
  })
  test('rejects a publish job that waits on macOS, and one that drops the Windows upload', () => {
    const waits = run(
      PUBLISH_GATED.replace('always() &&', "always() && needs.upload-ide-macos.result == 'success' &&"),
    )
    assert.ok(waits.some((p) => p.includes('must not wait on a macOS job')))
    const drops = run(
      PUBLISH_GATED.replace(" && needs.upload-ide-windows-amd64.result == 'success'", ''),
    )
    assert.ok(drops.some((p) => p.includes('lacks upload-ide-windows-amd64')))
  })
})

describe('checkOnlyMacosReleaseJobsMayFail, macOS upload', () => {
  test('rejects a release without a macOS IDE upload job', () => {
    const text = RELEASE_OK.replace('enso-build-ci-gen-upload-ide-macos-aarch64', 'something-else')
    const problems = checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text }))
    assert.ok(problems.some((p) => p.includes('no macOS IDE upload job')))
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
  test('accepts a Windows-only smoke test after the upload', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': packaging(
        "- if: matrix.os == 'windows'\n        run: ./tools/ci/windows-installer-smoke.ps1",
      ),
    })
    assert.deepEqual(checkWindowsInstallerSmokeTest(repo), [])
    assert.deepEqual(checkIdePackagingNeedsNoCloudAccount(repo), [])
  })
  test('rejects a smoke test on every platform, and a cloud account', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': packaging(
        '- run: ./tools/ci/windows-installer-smoke.ps1\n        env: { ENSO_TEST_USER: x }',
      ),
    })
    assert.equal(checkWindowsInstallerSmokeTest(repo).length, 1)
    assert.equal(checkIdePackagingNeedsNoCloudAccount(repo).length, 1)
  })
})

test('the repository follows the policy', () => {
  assert.deepEqual(checkRepo(repoRoot), [])
})
