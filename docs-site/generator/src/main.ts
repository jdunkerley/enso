/**
 * @file `generate`: read the catalogues of a distribution (or the fixtures) and write the
 * Components reference into `docs-site/`. Usage:
 * `corepack pnpm --filter docs-site run generate -- --lib <distribution>/lib [--min-function-pages <n>]`
 * or `-- --fixtures`.
 */
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { FIXTURES_LIB, readLibraries } from './catalogue'
import { buildModel, isFunctionPage } from './model'
import { writeSite } from './output'
import { formatReport } from './report'
import { styleViolations } from './style'

/**
 * The fewest function pages a run with `--lib` may write, unless `--min-function-pages` says
 * otherwise: 80 % of the 3244 the develop distribution gave on 2026-11-05, rounded down to a
 * hundred. Fewer means a catalogue came out empty or truncated. `--fixtures` runs have no floor.
 */
export const MIN_FUNCTION_PAGES = 2500

/**
 * Whether documentation style violations (`style.ts`) fail the run. On since Date's docs were
 * rewritten to the house style (the Date documentation pilot): a violation in an opted-in module
 * fails the Docs Site CI job.
 */
export const STYLE_GATE = true

const SITE_DIR = fileURLToPath(new URL('../..', import.meta.url))

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  // `--no-style-gate`: report violations without failing, for catalogues that are not this
  // checkout's (`docs-site.yml` builds with develop's).
  allowNegative: true,
  options: {
    lib: { type: 'string', multiple: true },
    fixtures: { type: 'boolean' },
    'min-function-pages': { type: 'string' },
    'style-gate': { type: 'boolean' },
  },
})

const roots = [...(values.lib ?? []), ...(values.fixtures ? [FIXTURES_LIB] : [])]
if (!roots.length) {
  console.error('Give a distribution lib directory (--lib <dir>) or --fixtures.')
  process.exit(2)
}
const model = buildModel(readLibraries(roots))
writeSite(model, SITE_DIR)
console.info(formatReport(model))
const floor = Number(values['min-function-pages'] ?? (values.lib?.length ? MIN_FUNCTION_PAGES : 0))
const functionPages = model.pages.filter(isFunctionPage).length
if (functionPages < floor) {
  console.error(
    `Only ${functionPages} function pages, below the floor of ${floor}: is a catalogue empty?`,
  )
  process.exit(1)
}

const violations = styleViolations(model)
if (violations.length) {
  const gated = values['style-gate'] ?? STYLE_GATE
  const print = gated ? console.error : console.warn
  for (const v of violations) print(`${v.page}: ${v.rule}`)
  print(`${violations.length} documentation style violations (STYLE_CHECKED_MODULES).`)
  if (gated) process.exit(1)
}
