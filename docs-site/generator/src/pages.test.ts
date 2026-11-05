import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { FIXTURES_LIB, readLibraries } from './catalogue'
import { readGroups } from './groups'
import { buildModel } from './model'
import { renderPage } from './pages'

const model = buildModel(readLibraries([FIXTURES_LIB]))
const render = (path: string) => renderPage(model.byPath.get(path)!, model)

test('a function page has every section in order, and keeps unknown sections', () => {
  const mdx = render('Standard.Fixture/Shapes/Shape.area')
  const order = [
    '# Shape.area',
    '<ComponentNode',
    ':::caution',
    '**Group**: Selections',
    '## Arguments',
    '## Returns',
    '## Examples',
    '## Errors',
    '## Remarks',
    '## Implementation Notes',
  ]
  const positions = order.map((marker) => mdx.indexOf(marker))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  expect(mdx).toContain('slug: "/api/Standard.Fixture/Shapes/Shape.area/"')
  expect(mdx).toContain('keywords: ["doubled","extent","size"]')
  expect(mdx).toContain('**Aliases**: `doubled`, `extent`, `size`')
  expect(mdx).toContain('Uses \\{braces\\} and &lt;angles&gt;')
  expect(mdx).toContain('| `units` | Text \\| Nothing | `Nothing` | The units. |')
  expect(mdx).toContain('- `extra`: Not an argument.')
  expect(mdx).toContain("Allowed values for `units`: `'cm'`, `'m'`")
  expect(mdx).toContain('**Unstable**')
  expect(mdx).toContain('Added in 2026.1')
})

test('prose code spans that name a type of the library link to it', () => {
  expect(render('Standard.Fixture/Shapes/Shape.area')).toContain('[`Square`](../Square/index.mdx)')
  expect(render('Standard.Fixture/Shapes/Shape.area')).toContain(
    '[`Square.side`](../Square.side/index.mdx)',
  )
})

test('a type page lists constructors, methods, conversions and extensions', () => {
  const square = render('Standard.Fixture/Shapes/Square')
  expect(square).toContain('Inherits from [Shape](../Shape/index.mdx)')
  expect(square).toContain('## Constructors')
  expect(square).toContain('### [Square.Value](../Square.Value/index.mdx)')
  expect(square).toContain('## Conversions')
  // Base is not in the fixture build, so `Integer` has no page and stays plain.
  expect(square).toContain('### From Integer')
  const shape = render('Standard.Fixture/Shapes/Shape')
  expect(shape).toContain('Exported from `Standard.Fixture`')
  expect(shape).toContain('## Static methods')
  expect(shape).toContain('## Extension methods')
  expect(shape).toContain('### Standard.Fixture_Ext')
  expect(shape).toContain('(../../../Standard.Fixture_Ext/Describe/Shape.describe/index.mdx)')
})

test('module and library pages', () => {
  expect(render('Standard.Fixture/Shapes')).toContain('## Types')
  expect(render('Standard.Fixture/Shapes')).toContain('### [make_shape](make_shape/index.mdx)')
  expect(render('Standard.Fixture')).toContain('## Modules')
  expect(render('Standard.Fixture_Ext/Describe')).toContain('## Extension methods')
})

test('an entry without documentation still renders', () => {
  expect(render('Standard.Fixture/Shapes/Shape.undocumented')).toContain('# Shape.undocumented')
})

test('golden: Table.filter', () => {
  const golden = fileURLToPath(new URL('../fixtures/golden', import.meta.url))
  const base = readGroups(
    readFileSync(
      fileURLToPath(
        new URL('../../../distribution/lib/Standard/Base/0.0.0-dev/package.yaml', import.meta.url),
      ),
      'utf8',
    ),
  )
  const table = readLibraries([`${golden}/lib`])
  const goldenModel = buildModel([
    { name: base.library, dir: '', groups: base.groups, catalogue: undefined },
    ...table,
  ])
  const page = goldenModel.byPath.get('Standard.Table/Table/Table.filter')!
  expect(renderPage(page, goldenModel)).toBe(readFileSync(`${golden}/Table.filter.mdx`, 'utf8'))
})

test('a method another module defines on a type of the same library is on both pages (R7)', () => {
  expect(render('Standard.Fixture/Measures')).toContain('## Extension methods')
  expect(render('Standard.Fixture/Measures')).toContain(
    '### [perimeter](Square.perimeter/index.mdx)',
  )
  expect(render('Standard.Fixture/Shapes/Square')).toContain(
    '### [perimeter](../../Measures/Square.perimeter/index.mdx)',
  )
})
