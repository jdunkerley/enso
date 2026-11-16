// @vitest-environment node
import { expect, test } from 'vitest'
import type { CatalogueEntry, LibraryInput } from './catalogue'
import { buildModel } from './model'
import { styleViolations } from './style'

const DATE = 'Standard.Base.Data.Time.Date'
const INT = 'Standard.Base.Data.Numbers.Integer'
const ANY = 'Standard.Base.Any.Any'

const arg = (name: string, reprType: string) => ({
  name,
  reprType,
  isSuspended: false,
  hasDefault: false,
})

const GOOD = [
  'Adds a number of days to this date.',
  '',
  '## Arguments',
  '- `days`: How many days to add.',
  '',
  '## Examples',
  '### Add a week',
  '```',
  'date = Date.new 2020 12 23',
  'later = date.add_days 7',
  '# → 2020-12-30',
  '```',
].join('\n')

/** A model with one instance method `Date.add_days` documented by `documentation`. */
function modelOf(
  documentation: string,
  args = [arg('self', DATE), arg('days', INT)],
  module = DATE,
) {
  const entries = [
    { type: 'module', module: 'Standard.Base.Main', reexports: [] },
    {
      type: 'type',
      module,
      name: 'Date',
      params: [],
      parentType: ANY,
      documentation: 'A date.',
      reexports: [],
    },
    {
      type: 'method',
      module,
      name: 'add_days',
      arguments: args,
      selfType: `${module}.Date`,
      returnType: `${module}.Date`,
      isStatic: false,
      documentation,
      annotations: [],
      reexports: [],
    },
  ] as CatalogueEntry[]
  const library: LibraryInput = {
    name: 'Standard.Base',
    dir: '',
    groups: [],
    catalogue: {
      format: 1,
      library: 'Standard.Base',
      version: '0.0.0-dev',
      engineVersion: '0.0.0-dev',
      sourceHash: 'test',
      entries,
    },
  }
  return buildModel([library])
}

const rules = (documentation: string, args?: ReturnType<typeof arg>[], module?: string) =>
  styleViolations(modelOf(documentation, args, module)).map((v) => v.rule)

/** `GOOD` with its example's code replaced. */
const withExample = (code: string[]) =>
  GOOD.replace(/```\n[\s\S]*\n```/, ['```', ...code, '```'].join('\n'))

test('a conforming doc has no violations', () => {
  expect(rules(GOOD)).toEqual([])
})

test('a page outside the checked modules is never checked', () => {
  expect(rules('Nothing documented.', undefined, 'Standard.Base.Data.Other')).toEqual([])
  expect(styleViolations(modelOf('Nothing documented.'), [])).toEqual([])
})

test('the violation names its page', () => {
  const [violation] = styleViolations(modelOf('Adds days.'))
  expect(violation?.page).toBe('Date.add_days')
})

test('an argument typed Any has no type, unless a remark names it', () => {
  const args = [arg('self', DATE), arg('days', INT), arg('unit', ANY)]
  const doc = GOOD.replace('days to add.', 'days to add.\n- `unit`: The unit.')
  expect(rules(doc, args)).toEqual(['argument unit has no type'])
  const remark = `${doc}\n\n## Remarks\n### Why \`unit\` is untyped\nIt takes anything.`
  expect(rules(remark, args)).toEqual([])
})

test('an undocumented argument', () => {
  expect(rules(GOOD, [arg('self', DATE), arg('days', INT), arg('extra', INT)])).toEqual([
    'argument extra is not documented',
  ])
  expect(rules(GOOD.replace('## Arguments\n- `days`: How many days to add.\n\n', ''))).toEqual([
    'argument days is not documented',
  ])
})

test('an Arguments bullet that is not an argument', () => {
  expect(rules(GOOD.replace('days to add.', 'days to add.\n- `bogus`: Not here.'))).toEqual([
    '## Arguments names bogus, which is not an argument',
  ])
})

test('no example', () => {
  const noExamples = GOOD.slice(0, GOOD.indexOf('## Examples')).trim()
  expect(rules(noExamples)).toEqual(['no example'])
  expect(rules(`${noExamples}\n\n## Examples\nNone yet.`)).toEqual(['no example'])
})

test('an example that does not parse', () => {
  expect(rules(withExample(['date = (Date.new 2020']))).toEqual(['example 1 does not parse'])
})

test('an example that imports', () => {
  expect(
    rules(withExample(['from Standard.Base import all', 'date = Date.new 2020 12 23'])),
  ).toEqual(['example 1 imports'])
  expect(
    rules(withExample(['import Standard.Base.Data.Time.Date', 'date = Date.new 2020'])),
  ).toEqual(['example 1 imports'])
})

test('an example that binds example_*', () => {
  expect(rules(withExample(['example_date = Date.new 2020 12 23']))).toEqual([
    'example 1 binds example_*',
  ])
})

test('the result line must be last, and examples are numbered', () => {
  const second = '```\ndate = Date.new 2020\n# → 2020\nnext = date.next\n```'
  expect(rules(`${GOOD}\n\n### Another\n${second}`)).toEqual([
    'example 2: the result line is not last',
  ])
})
