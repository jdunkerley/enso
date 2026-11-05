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

const SITE_DIR = fileURLToPath(new URL('../..', import.meta.url))

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    lib: { type: 'string', multiple: true },
    fixtures: { type: 'boolean' },
    'min-function-pages': { type: 'string' },
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
const floor = Number(values['min-function-pages'] ?? 0)
const functionPages = model.pages.filter(isFunctionPage).length
if (functionPages < floor) {
  console.error(
    `Only ${functionPages} function pages, below the floor of ${floor}: is a catalogue empty?`,
  )
  process.exit(1)
}
