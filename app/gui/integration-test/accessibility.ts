/**
 * @file Accessibility checks against a checked-in baseline.
 *
 * `expectNoNewAxeViolations` runs axe-core on the page (or part of it) and fails on any violation
 * that is not listed in the screen's baseline file under `accessibility-baseline/`. The baseline
 * records the violations the dashboard already had when the check was introduced (#81), so a port
 * may fix them but must not add new ones.
 *
 * Regenerate a baseline with `UPDATE_AXE_BASELINE=true`, on Linux, and review the diff: every added
 * line is a new violation that needs a reason to be accepted.
 */
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import { expect, test, type Page } from './base'

const BASELINE_DIR = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  'accessibility-baseline',
)
const UPDATE_BASELINE = process.env.UPDATE_AXE_BASELINE === 'true'

/**
 * The rules checked: WCAG 2.0, 2.1 and 2.2, levels A and AA. axe's `best-practice` rules are left
 * out: they are advice rather than conformance, and several (landmarks, `region`) judge the page
 * shell rather than the screen under test.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

/** One violating node, as recorded in a baseline. */
export interface AxeBaselineEntry {
  readonly rule: string
  readonly impact: string
  readonly target: string
}

/**
 * The key a violation is matched on: rule id plus the node's selector.
 *
 * Two parts of axe's selectors change without the page changing, so they are normalized:
 * - IDs generated per render — any id that contains a digit (a counter) or an escaped colon —
 *   become `#<generated>`;
 * - Vue's scoped-style attributes (`[data-v-1a2b3c4d]`), whose hash covers the component's source
 *   in production builds, are dropped.
 *
 * Everything else in axe's selector is deterministic for a given DOM.
 */
export function normalizeTarget(target: string) {
  return target
    .replace(/\[data-v-[0-9a-f]+(?:="")?\]/g, '')
    .replace(/#(?:[^\s>.:[\]\\]|\\.)+/g, (id) => (/\d|\\:/.test(id) ? '#<generated>' : id))
}

function entryKey(entry: Pick<AxeBaselineEntry, 'rule' | 'target'>) {
  return `${entry.rule} ${entry.target}`
}

/** Options for {@link expectNoNewAxeViolations}. */
export interface AxeCheckOptions {
  /** Selectors to scan; the whole page when omitted. */
  readonly include?: readonly string[]
}

/**
 * Wait until no finite animation or transition is running on the page.
 *
 * Several axe rules measure layout (`target-size`, `color-contrast`), so a panel still sliding in
 * gives different results from run to run. This waits for the state rather than for a duration;
 * infinite animations (spinners) are ignored, since they never finish.
 */
export async function waitForAnimationsToSettle(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  )
}

/**
 * Run axe on the current page, once its animations have settled, and fail on any violation not in
 * the `screen` baseline.
 *
 * Baseline entries that no longer occur are reported as a test annotation, not a failure, so a fix
 * does not break the build; drop them by regenerating the baseline.
 */
export async function expectNoNewAxeViolations(
  page: Page,
  screen: string,
  options: AxeCheckOptions = {},
) {
  await waitForAnimationsToSettle(page)
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  for (const selector of options.include ?? []) builder = builder.include(selector)
  const results = await builder.analyze()

  const current: AxeBaselineEntry[] = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      impact: node.impact ?? violation.impact ?? 'unknown',
      target: normalizeTarget(node.target.map((part) => [part].flat().join(' >>> ')).join(' >>> ')),
    })),
  )

  const baselineFile = path.join(BASELINE_DIR, `${screen}.json`)
  if (UPDATE_BASELINE) {
    const sorted = [...current].sort((a, b) => entryKey(a).localeCompare(entryKey(b), 'en'))
    await fs.mkdir(BASELINE_DIR, { recursive: true })
    await fs.writeFile(baselineFile, JSON.stringify(sorted, null, 2) + '\n')
    return
  }

  // Compared as multisets: normalized targets can coincide (two generated ids), so a key that
  // occurs more often than in the baseline is a new violation too.
  const baseline: AxeBaselineEntry[] = JSON.parse(await fs.readFile(baselineFile, 'utf8'))
  const remaining = new Map<string, number>()
  for (const entry of baseline)
    remaining.set(entryKey(entry), (remaining.get(entryKey(entry)) ?? 0) + 1)
  const added: AxeBaselineEntry[] = []
  for (const entry of current) {
    const count = remaining.get(entryKey(entry)) ?? 0
    if (count > 0) remaining.set(entryKey(entry), count - 1)
    else added.push(entry)
  }
  const fixed = [...remaining].filter(([, count]) => count > 0).map(([key]) => key)
  if (fixed.length > 0) {
    test.info().annotations.push({
      type: 'axe baseline entries no longer found',
      description: fixed.join('\n'),
    })
  }
  const details = added.map((entry) => {
    const violation = results.violations.find((v) => v.id === entry.rule)
    return `${entry.rule} (${entry.impact}) at ${entry.target}: ${violation?.help ?? ''}`
  })
  expect(details, `New accessibility violations on the ${screen} screen`).toEqual([])
}
