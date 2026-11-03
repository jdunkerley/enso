/**
 * @file The JUnit reports the standard-library tests write (`Standard/Test` `Test_Reporter.enso`,
 * one `<junit dir>/<project>/JUnit.xml` per project), and the side-by-side comparison of two runs.
 * A pending group is one `PENDING` test case with `<skipped>`; it counts as a skip.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** A test case's outcome. */
export type Status = 'pass' | 'fail' | 'skip'

/** One test case. */
export interface TestCase {
  readonly suite: string
  readonly name: string
  readonly status: Status
}

/** Pass, fail and skip counts. */
export interface Counts {
  readonly pass: number
  readonly fail: number
  readonly skip: number
}

const unescape = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

/** The test cases in one `JUnit.xml`. */
export function parseJUnit(xml: string): TestCase[] {
  const cases: TestCase[] = []
  const suites = /<testsuite\s[^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/testsuite>/g
  const testCases = /<testcase\s[^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g
  for (const suite of xml.matchAll(suites)) {
    for (const testCase of (suite[2] ?? '').matchAll(testCases)) {
      const body = testCase[2] ?? ''
      cases.push({
        suite: unescape(suite[1] ?? ''),
        name: unescape(testCase[1] ?? ''),
        status:
          body.includes('<failure') ? 'fail'
          : body.includes('<skipped') ? 'skip'
          : 'pass',
      })
    }
  }
  return cases
}

/** The counts of `cases`. */
export function count(cases: readonly TestCase[]): Counts {
  return {
    pass: cases.filter((c) => c.status === 'pass').length,
    fail: cases.filter((c) => c.status === 'fail').length,
    skip: cases.filter((c) => c.status === 'skip').length,
  }
}

/** Every project's test cases in a JUnit directory (`<dir>/<project>/JUnit.xml`). */
export function readJUnitDir(dir: string): Map<string, TestCase[]> {
  const projects = new Map<string, TestCase[]>()
  if (!existsSync(dir)) return projects
  for (const project of readdirSync(dir).sort()) {
    const file = path.join(dir, project, 'JUnit.xml')
    if (existsSync(file)) projects.set(project, parseJUnit(readFileSync(file, 'utf8')))
  }
  return projects
}

/** The label of a group's backend: the leading `[…]` of its name, if any. */
export function groupPrefix(suite: string): string {
  return /^\[[^\]]+\]/.exec(suite)?.[0] ?? '(no prefix)'
}

/**
 * Every project's test cases pooled and keyed by `groupPrefix` instead of by project, so that
 * groups which moved from one project to another compare with themselves.
 */
export function byGroupPrefix(
  run: ReadonlyMap<string, readonly TestCase[]>,
): Map<string, TestCase[]> {
  const grouped = new Map<string, TestCase[]>()
  for (const cases of run.values()) {
    for (const testCase of cases) {
      const key = groupPrefix(testCase.suite)
      grouped.set(key, [...(grouped.get(key) ?? []), testCase])
    }
  }
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/** One project's row in the comparison. */
export interface ProjectComparison {
  readonly project: string
  readonly old: Counts | null
  readonly new: Counts | null
  readonly same: boolean
  /** Up to 20 test cases whose status differs, or that exist on one side only. */
  readonly changed: readonly string[]
}

const sameCounts = (a: Counts | null, b: Counts | null) =>
  a != null && b != null && a.pass === b.pass && a.fail === b.fail && a.skip === b.skip

/** Compares two runs project by project: pass, fail and skip counts must all match. */
export function compareRuns(
  oldRun: ReadonlyMap<string, readonly TestCase[]>,
  newRun: ReadonlyMap<string, readonly TestCase[]>,
): ProjectComparison[] {
  const projects = [...new Set([...oldRun.keys(), ...newRun.keys()])].sort()
  return projects.map((project) => {
    const before = oldRun.get(project)
    const after = newRun.get(project)
    const tally = (cases: readonly TestCase[] | undefined) => {
      const statuses = new Map<string, Status[]>()
      for (const c of cases ?? []) {
        const key = `${c.suite} › ${c.name}`
        statuses.set(key, [...(statuses.get(key) ?? []), c.status].sort())
      }
      return statuses
    }
    const oldStatuses = tally(before)
    const newStatuses = tally(after)
    const changed: string[] = []
    for (const key of [...new Set([...oldStatuses.keys(), ...newStatuses.keys()])].sort()) {
      const a = (oldStatuses.get(key) ?? []).join(',') || 'absent'
      const b = (newStatuses.get(key) ?? []).join(',') || 'absent'
      if (a !== b && changed.length < 20) changed.push(`${key}: ${a} → ${b}`)
    }
    const oldCounts = before == null ? null : count(before)
    const newCounts = after == null ? null : count(after)
    return {
      project,
      old: oldCounts,
      new: newCounts,
      same: sameCounts(oldCounts, newCounts),
      changed,
    }
  })
}

/** The comparison as a Markdown table, with the changed cases of each differing project below it. */
export function comparisonMarkdown(rows: readonly ProjectComparison[]): string[] {
  const show = (c: Counts | null) => (c == null ? 'missing' : `${c.pass} / ${c.fail} / ${c.skip}`)
  const lines = [
    '| Project | old pass / fail / skip | new pass / fail / skip | |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.project} | ${show(r.old)} | ${show(r.new)} | ${r.same ? 'same' : '**DIFFERS**'} |`,
    ),
  ]
  for (const row of rows.filter((r) => !r.same && r.changed.length > 0)) {
    lines.push('', `${row.project}:`, ...row.changed.map((change) => `- ${change}`))
  }
  return lines
}

/** A summary of one run, for the job's step summary. */
export function summaryMarkdown(run: ReadonlyMap<string, readonly TestCase[]>): string[] {
  return [
    '| Project | pass | fail | skip |',
    '| --- | --- | --- | --- |',
    ...[...run.entries()].map(([project, cases]) => {
      const c = count(cases)
      return `| ${project} | ${c.pass} | ${c.fail} | ${c.skip} |`
    }),
  ]
}
