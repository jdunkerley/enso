import { expect, test } from 'vitest'
import { FIXTURES_LIB, readLibraries } from './catalogue'
import { nodeColor, nodeJsx, nodeProps, unknownIcons } from './componentNode'
import { colorFromString } from './gui'
import { buildModel, type Page } from './model'

const model = buildModel(readLibraries([FIXTURES_LIB]))
const fn = (path: string) => model.byPath.get(path) as Page & { entry: NonNullable<Page['entry']> }

test("a grouped function: the group's colour, its icon, every argument but self", () => {
  const props = nodeProps(fn('Standard.Fixture/Shapes/Shape.area'), model)
  expect(props).toEqual({
    name: 'area',
    icon: 'preparation',
    color: 'var(--group-color-Standard-Fixture-Selections)',
    returns: 'Returns Float',
    params: [
      { name: 'units', tooltip: 'Text | Nothing = Nothing', optional: true },
      {
        name: 'scale',
        tooltip: '~Float = Missing_Argument.throw "scale"',
        optional: false,
      },
    ],
    label:
      'area(units: Text | Nothing = Nothing, scale: ~Float = Missing_Argument.throw "scale") -> Float',
  })
})

test("a bare group name resolves against the entry's own library; another library's by its full name", () => {
  expect(nodeColor(fn('Standard.Fixture/Shapes/Shape.unit'), model)).toBe(
    'var(--group-color-Standard-Fixture-Shaping)',
  )
  expect(nodeColor(fn('Standard.Fixture_Ext/Describe/Shape.describe'), model)).toBe(
    'var(--group-color-Standard-Fixture-Shaping)',
  )
})

test('ungrouped: coloured from the declared return type, as computeNodeColor does', () => {
  expect(nodeColor(fn('Standard.Fixture/Shapes/Shape.undocumented'), model)).toBe(
    colorFromString('Standard.Fixture.Shapes.Square'),
  )
})

test('ungrouped returning Any or a union: the fallback colour', () => {
  expect(nodeColor(fn('Standard.Fixture/Shapes/make_shape'), model)).toBe(
    'var(--group-color-fallback)',
  )
  expect(nodeColor(fn('Standard.Fixture/Shapes/Shape.odd_icon'), model)).toBe(
    'var(--group-color-fallback)',
  )
})

test('an unknown icon falls back to the logo and is counted', () => {
  expect(nodeProps(fn('Standard.Fixture/Shapes/Shape.odd_icon'), model).icon).toBe('enso_logo')
  expect(unknownIcons.has('not_an_icon')).toBe(true)
})

test('static methods and constructors are labelled Type.name', () => {
  expect(nodeProps(fn('Standard.Fixture/Shapes/Shape.unit'), model).name).toBe('Shape.unit')
  expect(nodeProps(fn('Standard.Fixture/Shapes/Square.Value'), model).params).toEqual([
    { name: 'side', tooltip: 'Float', optional: false },
  ])
})

test('the JSX is one self-closing element with JSON props', () => {
  const jsx = nodeJsx({
    name: 'a',
    icon: 'b',
    color: 'c',
    returns: 'd',
    params: [],
    label: 'e',
  })
  expect(jsx).toBe(
    '<ComponentNode name={"a"} icon={"b"} color={"c"} returns={"d"} params={[]} label={"e"} />',
  )
})
