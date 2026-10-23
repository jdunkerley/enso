/** @file Reading the Enso test reporter's JUnit XML, and comparing two runs. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareRuns, comparisonMarkdown, count, parseJUnit, readJUnitDir } from './junit.ts'

/** The shape `Test_Reporter.enso` writes: a passing, a failing and a pending case, and a pending group. */
const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
    <testsuite name="Text &amp; Strings" timestamp="2026-10-21T20:00:00" tests="3" disabled="1" errors="1" time="0.5">
        <testcase name="should &lt;split&gt;" time="0.1">        </testcase>
        <testcase name="should fail" time="0.2">
            <failure message="Expected 1, got 2">
Expected 1, got 2
            </failure>
        </testcase>
        <testcase name="should wait" time="0.0">
            <skipped message="Reason: not yet"/>
                </testcase>
    </testsuite>
    <testsuite name="Postgres" timestamp="2026-10-21T20:00:00" tests="0" disabled="1" errors="0" time="0.0">
        <testcase name="PENDING" time="0.0">
            <skipped message="Reason: PostgreSQL test database is not configured."/>
        </testcase>
    </testsuite>
</testsuites>
`

test('parses suites and cases, unescaped, with their status', () => {
  expect(parseJUnit(REPORT)).toEqual([
    { suite: 'Text & Strings', name: 'should <split>', status: 'pass' },
    { suite: 'Text & Strings', name: 'should fail', status: 'fail' },
    { suite: 'Text & Strings', name: 'should wait', status: 'skip' },
    { suite: 'Postgres', name: 'PENDING', status: 'skip' },
  ])
  expect(count(parseJUnit(REPORT))).toEqual({ pass: 1, fail: 1, skip: 2 })
})

describe('compareRuns', () => {
  const run = (...projects: [project: string, xml: string][]) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'junit-'))
    for (const [project, xml] of projects) {
      mkdirSync(path.join(dir, project))
      writeFileSync(path.join(dir, project, 'JUnit.xml'), xml)
    }
    return readJUnitDir(dir)
  }
  test('identical runs are the same', () => {
    const rows = compareRuns(run(['Base_Tests', REPORT]), run(['Base_Tests', REPORT]))
    expect(rows).toEqual([
      {
        project: 'Base_Tests',
        old: { pass: 1, fail: 1, skip: 2 },
        new: { pass: 1, fail: 1, skip: 2 },
        same: true,
        changed: [],
      },
    ])
  })
  test('a skip that became a pass differs, and names the case', () => {
    const fixed = REPORT.replace(
      '<testcase name="PENDING" time="0.0">\n            <skipped message="Reason: PostgreSQL test database is not configured."/>\n        </testcase>',
      '<testcase name="PENDING" time="0.0"></testcase>',
    )
    const [row] = compareRuns(run(['Table_Tests', REPORT]), run(['Table_Tests', fixed]))
    expect(row?.same).toBe(false)
    expect(row?.changed).toEqual(['Postgres › PENDING: skip → pass'])
  })
  test('a project missing on one side differs', () => {
    const rows = compareRuns(run(['A_Tests', REPORT]), run(['B_Tests', REPORT]))
    expect(rows.map((row) => [row.project, row.same])).toEqual([
      ['A_Tests', false],
      ['B_Tests', false],
    ])
    expect(comparisonMarkdown(rows)[2]).toBe('| A_Tests | 1 / 1 / 2 | missing | **DIFFERS** |')
  })
})
