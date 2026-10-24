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
  checkIdePackagingNeedsNoCloudAccount,
  checkMacosChecksRunWhatIsRequested,
  checkMacosJobsAreGated,
  checkOnlyMacosReleaseJobsMayFail,
  checkPullRequestsIgnoreSpecs,
  checkReleaseIsIdeOnly,
  checkRepo,
  checkSbtRunsAfterSetupJvm,
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

const GATE_IF = "if: needs.check-the-mac-os-runner.outputs.online == 'true'"

const RELEASE_OK = `
name: Release
on: workflow_dispatch
env:
  ENSO_BUILD_UPDATE_INFO: "true"
jobs:
  check-the-mac-os-runner:
    runs-on: ubuntu-latest
    steps: []
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
    continue-on-error: true
    steps: []
  upload-ide:
    runs-on: ubuntu-latest
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  upload-ide-macos:
    needs: [check-the-mac-os-runner, build-backend-macos]
    ${GATE_IF}
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  publish-release:
    runs-on: ubuntu-latest
    needs: [draft-release, license-check, upload-ide, upload-ide-macos]
    if: "!cancelled() && (inputs.release-id != '' || (inputs.publish && needs.draft-release.result == 'success' && needs.license-check.result == 'success' && needs.upload-ide.result == 'success'))"
    steps:
      - run: corepack pnpm --filter build-scripts run release publish
  update-latest-release-version:
    runs-on: ubuntu-latest
    needs: [draft-release, publish-release]
    if: "!cancelled() && needs.publish-release.result == 'success'"
    steps:
      - run: corepack pnpm --filter build-scripts run release update-latest-version
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

describe('checkOnlyMacosReleaseJobsMayFail', () => {
  const problems = (text) =>
    checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text }))
  test('accepts tolerant macOS backend and IDE jobs', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('rejects a tolerant Linux job and a blocking macOS upload', () => {
    const text = RELEASE_OK.replace(
      '    runs-on: [self-hosted, macOS]\n    continue-on-error: true\n    steps:\n',
      '    runs-on: [self-hosted, macOS]\n    steps:\n',
    ).replace(
      '  draft-release:\n    runs-on: ubuntu-latest',
      '  draft-release:\n    runs-on: ubuntu-latest\n    continue-on-error: true',
    )
    const found = problems(text)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('draft-release: only macOS jobs')))
    assert.ok(found.some((p) => p.includes('upload-ide-macos: a macOS backend or IDE job')))
  })
  test('rejects a release without its macOS IDE upload job, and an unexpected macOS job', () => {
    const found = problems(RELEASE_OK.replace('upload-ide-macos:', 'something-else:'))
    assert.ok(found.some((p) => p.includes('has no macOS job `upload-ide-macos`')))
    assert.ok(found.some((p) => p.includes('something-else: unexpected macOS job')))
  })
})

describe('checkMacosJobsAreGated', () => {
  const problems = (text) => checkMacosJobsAreGated(fixture({ 'workflows/release.yml': text }))
  test('accepts a gated release whose publish job does not wait on macOS', () => {
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
      '  check-the-mac-os-runner:\n    runs-on: ubuntu-latest\n    steps: []\n',
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
  test('rejects a publish job that waits on macOS, and one that drops a required result', () => {
    const waits = problems(
      RELEASE_OK.replace(
        'inputs.publish && needs.draft-release',
        "inputs.publish && needs.upload-ide-macos.result == 'success' && needs.draft-release",
      ),
    )
    assert.ok(waits.some((p) => p.includes('must not wait on a macOS job')))
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
        \${{ inputs.libraries && '[{"suite": "standard-library-in-native"},
        {"suite": "standard-library"}, {"suite": "std-aws"}]' || '[]' }}
`

describe('checkMacosChecksRunWhatIsRequested', () => {
  const problems = (text) =>
    checkMacosChecksRunWhatIsRequested(fixture({ 'workflows/macos-checks.yml': text }))
  test('accepts one call that runs the JVM tests on engine and three suites on libraries', () => {
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

describe('checkToolchainPins', () => {
  const build = {
    'project/Dependencies.scala':
      'object Dependencies {\n  val graalVersion = "25.0.1"\n  val graalMavenPackagesVersion = "25.0.1"\n  val flatbuffersVersion      = "24.3.25"\n}\n',
    'project/build.properties': '# HELD at 1.10.6.\r\nsbt.version=1.10.6\r\n',
  }
  const config = (pins) => `latest-release: 2025.3.4\ntoolchain:\n${pins}`
  const allPins =
    '  graalvm: 25.0.1\n  sbt: 1.10.6 # held\n  flatc: 24.3.25\n  graalpy: 25.0.1\n'
  test("accepts pins equal to the build's own copies", () => {
    const repo = fixture({}, { 'build-config.yaml': config(allPins), ...build })
    assert.deepEqual(checkToolchainPins(repo), [])
  })
  test('rejects a pin that drifted, and a missing pin', () => {
    const pins = '  graalvm: 25.0.2\n  sbt: 1.10.6\n  graalpy: 25.0.1\n'
    const problems = checkToolchainPins(fixture({}, { 'build-config.yaml': config(pins), ...build }))
    assert.deepEqual(problems.sort(), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.2, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.1',
      'build-config.yaml: `toolchain.graalvm` is 25.0.2, but `graalVersion` in project/Dependencies.scala is 25.0.1',
      'build-config.yaml: no `toolchain.flatc` pin',
    ])
  })
  test('rejects a half-bumped GraalVM: the Maven packages behind the JDK', () => {
    const scala = build['project/Dependencies.scala'].replace(
      'graalMavenPackagesVersion = "25.0.1"',
      'graalMavenPackagesVersion = "25.0.0"',
    )
    const repo = fixture(
      {},
      { ...build, 'build-config.yaml': config(allPins), 'project/Dependencies.scala': scala },
    )
    assert.deepEqual(checkToolchainPins(repo), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.1, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.0',
      'build-config.yaml: `toolchain.graalpy` is 25.0.1, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.0',
    ])
  })
  test('compares versions as text, as the awk reader does', () => {
    const scala = build['project/Dependencies.scala'].replaceAll('"25.0.1"', '"25.0"')
    const repo = fixture(
      {},
      {
        ...build,
        'build-config.yaml': config(allPins.replaceAll('25.0.1', '25.0')),
        'project/Dependencies.scala': scala,
      },
    )
    assert.deepEqual(checkToolchainPins(repo), [])
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
        'project/Dependencies.scala': build['project/Dependencies.scala'],
      },
    )
    assert.deepEqual(checkToolchainPins(repo), ['project/build.properties: no `sbt.version` found'])
    assert.deepEqual(checkToolchainPins(fixture({})), ['build-config.yaml: missing'])
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
      "./run backend sbt '--' verifyLicensePackages",
      'command -v sbt',
      'echo sbt',
      'env | grep sbt',
      'echo "use sbt.bat"',
      'curl -fsSL -o "$dir/sbt.tgz" "https://github.com/sbt/sbt/releases/download/v1/sbt-1.tgz"',
      'echo "$RUNNER_TEMP/sbt/bin" >> "$GITHUB_PATH"',
      'time ./run backend get',
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

test('the repository follows the policy', () => {
  assert.deepEqual(checkRepo(repoRoot), [])
})

test('checkSetupNodeCache fails when it finds nothing to check', () => {
  const repo = fixture({ 'workflows/a.yml': 'on: push\njobs: {}\n' })
  assert.equal(checkSetupNodeCache(repo).length, 1)
})
