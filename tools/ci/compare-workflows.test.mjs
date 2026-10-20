// Run with `node --test tools/ci/compare-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compareWorkflow,
  describeWorkflow,
  diffLines,
  evaluateCondition,
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
      'step: run[bash]: echo linux | env: GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
      'secrets: GITHUB_TOKEN',
    ])
    assert.deepEqual(jobs.get('Build (windows)'), [
      'runs-on: windows-latest',
      'step: run[pwsh]: echo windows windows',
    ])
    assert.deepEqual(jobs.get('Lint (b)'), [
      'runs-on: ubuntu-latest',
      'needs: Build (linux)',
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
