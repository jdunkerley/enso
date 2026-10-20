// Run with `node --test tools/ci/compare-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import {
  compareWorkflow,
  describeWorkflow,
  diffLines,
  evaluateCondition,
  gitReader,
  matrixLegs,
} from './compare-workflows.mjs'

/** A reader over in-memory files. */
const memory = (files) => (file) => files[file] ?? null

describe('matrixLegs', () => {
  test('a job without a matrix has one leg', () => {
    assert.deepEqual(matrixLegs(undefined, {}), [null])
  })
  test('include-only matrices list their entries', () => {
    const legs = matrixLegs({ matrix: { include: [{ os: 'linux' }, { os: 'windows' }] } }, {})
    assert.deepEqual(legs, [{ os: 'linux' }, { os: 'windows' }])
  })
  test('axes multiply, include extends matching legs, exclude removes', () => {
    const legs = matrixLegs(
      {
        matrix: {
          os: ['linux', 'windows'],
          suite: ['a', 'b'],
          include: [{ os: 'linux', runner: 'ubuntu-latest' }],
          exclude: [{ os: 'windows', suite: 'b' }],
        },
      },
      {},
    )
    assert.deepEqual(legs, [
      { os: 'linux', suite: 'a', runner: 'ubuntu-latest' },
      { os: 'linux', suite: 'b', runner: 'ubuntu-latest' },
      { os: 'windows', suite: 'a' },
    ])
  })
  test('include may come from an input through fromJSON', () => {
    const legs = matrixLegs(
      { matrix: { include: '${{ fromJSON(inputs.suites) }}' } },
      { inputs: { suites: '[{"suite": "jvm"}]' } },
    )
    assert.deepEqual(legs, [{ suite: 'jvm' }])
  })
})

describe('evaluateCondition', () => {
  test('decides the platform, matrix values and inputs', () => {
    assert.deepEqual(evaluateCondition("runner.os == 'Windows'", {}, 'Linux'), { keep: false })
    assert.deepEqual(
      evaluateCondition("matrix.os == 'linux'", { matrix: { os: 'linux' } }, 'Linux'),
      {
        keep: true,
        rest: undefined,
      },
    )
    assert.deepEqual(evaluateCondition("inputs.os == 'linux'", { inputs: { os: 'windows' } }), {
      keep: false,
    })
  })
  test('keeps what it cannot decide, and never splits a disjunction', () => {
    assert.deepEqual(evaluateCondition("always() && runner.os != 'Windows'", {}, 'Linux'), {
      keep: true,
      rest: 'always()',
    })
    assert.deepEqual(evaluateCondition('${{ (always()) && (a || b) }}', {}, 'Linux'), {
      keep: true,
      rest: 'always() && (a || b)',
    })
    assert.deepEqual(evaluateCondition("runner.os == 'Windows' || x", {}, 'Linux'), {
      keep: true,
      rest: "('Linux' == 'Windows' || x)",
    })
  })
})

describe('describeWorkflow', () => {
  const files = {
    '.github/workflows/entry.yml': `
name: Entry
on: workflow_dispatch
jobs:
  platform:
    strategy:
      matrix:
        include:
          - { os: linux, runner: ubuntu-latest }
          - { os: windows, runner: windows-latest }
    uses: ./.github/workflows/called.yml
    with:
      os: \${{ matrix.os }}
      runner: \${{ matrix.runner }}
`,
    '.github/workflows/called.yml': `
on:
  workflow_call:
    inputs:
      os: { type: string, required: true }
      runner: { type: string, required: true }
jobs:
  build:
    name: Build (\${{ inputs.os }})
    runs-on: \${{ inputs.runner }}
    steps:
      - uses: ./.github/actions/greet
        with:
          who: \${{ inputs.os }}
  lint:
    name: Lint
    if: inputs.os == 'linux'
    needs: [build]
    runs-on: \${{ inputs.runner }}
    strategy:
      matrix:
        part: [a, b]
    steps:
      - run: lint \${{ matrix.part }}
`,
    '.github/actions/greet/action.yml': `
inputs:
  who: { required: true }
runs:
  using: composite
  steps:
    - if: runner.os == 'Windows'
      shell: pwsh
      run: echo windows \${{ inputs.who }}
    - if: runner.os != 'Windows'
      shell: bash
      run: echo \${{ inputs.who }}
      env:
        GITHUB_TOKEN: \${{ github.token }}
`,
  }

  test('flattens reusable calls, expands matrices, inlines composite actions', () => {
    const { jobs } = describeWorkflow(memory(files), '.github/workflows/entry.yml')
    assert.deepEqual([...jobs.keys()], ['Build (linux)', 'Lint (a)', 'Lint (b)', 'Build (windows)'])
    assert.deepEqual(jobs.get('Build (linux)'), [
      'runs-on: ubuntu-latest',
      'call: ./.github/workflows/called.yml | with: {"os":"linux","runner":"ubuntu-latest"}',
      'step: run[bash]: echo linux | env: GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
      'secrets: GITHUB_TOKEN',
    ])
    assert.deepEqual(jobs.get('Build (windows)'), [
      'runs-on: windows-latest',
      'call: ./.github/workflows/called.yml | with: {"os":"windows","runner":"windows-latest"}',
      'step: run[pwsh]: echo windows windows',
    ])
    assert.deepEqual(jobs.get('Lint (b)'), [
      'runs-on: ubuntu-latest',
      'needs: Build (linux)',
      'call: ./.github/workflows/called.yml | with: {"os":"linux","runner":"ubuntu-latest"}',
      'step: run[bash]: lint b',
    ])
  })

  test('identical versions report no differences', () => {
    const read = memory(files)
    const report = compareWorkflow(read, read, '.github/workflows/entry.yml')
    assert.ok(!report.includes('```diff'), report)
    assert.match(report, /### Unchanged jobs/)
  })
})

test('diffLines keeps common lines and marks the rest', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'c', 'd']), ['- b', '+ d'])
  assert.deepEqual(diffLines(['a'], ['a']), [])
})

describe('differences are reported', () => {
  const FILE = '.github/workflows/w.yml'
  const BASE = `
name: W
on: { pull_request: {} }
concurrency: { group: g }
permissions: { contents: read }
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - run: make
        working-directory: sub
      - run: ship
        env:
          TOKEN: \${{ secrets.TOKEN }}
      - uses: actions/upload-artifact@v4
        with: { name: out }
  test:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/develop'
    services: { db: { image: postgres:15 } }
    strategy: { fail-fast: true, matrix: { part: [a] } }
    steps:
      - run: test
  call:
    uses: ./.github/workflows/called.yml
    secrets: inherit
    with: { mode: fast }
`
  const CALLED = `
on: { workflow_call: { inputs: { mode: { type: string } } } }
jobs:
  inner:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ inputs.mode }}
`
  const read = (workflow) =>
    memory({ [FILE]: workflow, '.github/workflows/called.yml': CALLED })
  const report = (edit, renames) =>
    compareWorkflow(read(BASE), read(edit(BASE)), FILE, renames)
  const swap = (from, to) => (text) => {
    assert.ok(text.includes(from), `fixture lacks ${from}`)
    return text.replace(from, to)
  }
  const reports = (edit, expected) => {
    const result = report(edit)
    assert.ok(result.includes('```diff'), result)
    assert.ok(result.includes(expected), `${expected}\n${result}`)
  }

  test('identical files report nothing', () => {
    assert.ok(!report((text) => text).includes('```diff'))
  })
  test('a renamed job is only in base and only in head', () => {
    reports(swap('name: Build', 'name: Compile'), '### Build (only in base)')
    reports(swap('name: Build', 'name: Compile'), '### Compile (only in head)')
  })
  test('--rename pairs differently named jobs and their needs', () => {
    const result = report(swap('name: Build', 'name: Compile'), new Map([['Build', 'Compile']]))
    assert.ok(!result.includes('only in'), result)
    assert.ok(!result.includes('needs'), result)
  })
  test('a dropped step', () => reports(swap('      - run: ship\n', ''), '- step: run[bash]: ship'))
  test('a changed if', () => reports(swap("'refs/heads/develop'", "'refs/heads/main'"), '+ if:'))
  test('a changed secret', () => reports(swap('secrets.TOKEN', 'secrets.OTHER'), '+ secrets: OTHER'))
  test('a bracketed secret is found', () =>
    reports(swap('secrets.TOKEN', "secrets['OTHER']"), '+ secrets: OTHER'))
  test('a changed artifact name', () => reports(swap('name: out', 'name: other'), '+ uploads: other'))
  test('a changed working directory', () =>
    reports(swap('working-directory: sub', 'working-directory: elsewhere'), 'working-directory'))
  test('a changed services block', () => reports(swap('postgres:15', 'postgres:16'), 'services:'))
  test('a changed strategy option', () => reports(swap('fail-fast: true', 'fail-fast: false'), 'fail-fast'))
  test('a changed secrets: inherit', () => reports(swap('secrets: inherit', 'secrets: {}'), 'call:'))
  test('a changed call input', () => reports(swap('mode: fast', 'mode: slow'), 'call:'))
  test('header changes: triggers, concurrency, permissions', () => {
    reports(swap('pull_request: {}', 'push: {}'), '### Workflow')
    reports(swap('group: g', 'group: h'), '+ concurrency:')
    reports(swap('contents: read', 'contents: write'), '+ permissions:')
  })
  test('same-named jobs are not overwritten', () => {
    const twice = `
on: x
jobs:
  a: { name: Same, runs-on: ubuntu-latest, steps: [{ run: one }] }
  b: { name: Same, runs-on: ubuntu-latest, steps: [{ run: two }] }
`
    const { jobs } = describeWorkflow(memory({ [FILE]: twice }), FILE)
    assert.equal(jobs.size, 2)
  })
  test('a bad git ref fails loudly', () => {
    assert.throws(() => gitReader('no-such-ref-at-all'), /no-such-ref-at-all/)
  })
  test('the CLI rejects a malformed --rename and a bad base', () => {
    const script = new URL('./compare-workflows.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.notEqual(run('--base', 'HEAD', '--rename', 'noequals', 'x.yml').status, 0)
    assert.notEqual(run('--base', 'no-such-ref-at-all', 'x.yml').status, 0)
    assert.notEqual(run('--base').status, 0)
  })
})
