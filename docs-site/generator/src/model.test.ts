import { expect, test } from 'vitest'
import { FIXTURES_LIB, readLibraries, type LibraryInput } from './catalogue'
import { buildModel, CaseSafeDirs, isFunctionPage } from './model'

const model = buildModel(readLibraries([FIXTURES_LIB]))
const page = (path: string) => model.byPath.get(path)

test('classification and paths', () => {
  expect([...model.byPath.keys()].sort()).toEqual([
    'Standard.Fixture',
    'Standard.Fixture/Shapes',
    'Standard.Fixture/Shapes/Shape',
    'Standard.Fixture/Shapes/Shape.area',
    'Standard.Fixture/Shapes/Shape.odd_icon',
    'Standard.Fixture/Shapes/Shape.op-2b',
    'Standard.Fixture/Shapes/Shape.undocumented',
    'Standard.Fixture/Shapes/Shape.unit',
    'Standard.Fixture/Shapes/Square',
    'Standard.Fixture/Shapes/Square.Value',
    'Standard.Fixture/Shapes/Square.side',
    'Standard.Fixture/Shapes/make_shape',
    'Standard.Fixture_Ext',
    'Standard.Fixture_Ext/Describe',
    'Standard.Fixture_Ext/Describe/Shape.describe',
  ])
  expect(page('Standard.Fixture')?.kind).toBe('library')
  expect(page('Standard.Fixture/Shapes')?.kind).toBe('module')
  expect(page('Standard.Fixture/Shapes/Square.Value')?.kind).toBe('constructor')
  expect(page('Standard.Fixture/Shapes/Shape.unit')?.kind).toBe('staticMethod')
  expect(page('Standard.Fixture/Shapes/Shape.area')?.kind).toBe('instanceMethod')
  expect(page('Standard.Fixture/Shapes/Square.side')?.kind).toBe('instanceMethod')
  expect(page('Standard.Fixture/Shapes/make_shape')?.kind).toBe('moduleFunction')
  expect(page('Standard.Fixture_Ext/Describe/Shape.describe')?.kind).toBe('extensionMethod')
})

test('titles and node names', () => {
  expect(page('Standard.Fixture/Shapes/Shape.area')).toMatchObject({
    title: 'Shape.area',
    nodeName: 'area',
  })
  expect(page('Standard.Fixture/Shapes/Shape.unit')).toMatchObject({
    title: 'Shape.unit',
    nodeName: 'Shape.unit',
  })
  expect(page('Standard.Fixture/Shapes/Square.Value')).toMatchObject({
    title: 'Square.Value',
    nodeName: 'Square.Value',
  })
  expect(page('Standard.Fixture/Shapes/make_shape')).toMatchObject({
    title: 'make_shape',
    nodeName: 'make_shape',
  })
  expect(page('Standard.Fixture/Shapes/Shape.op-2b')).toMatchObject({
    title: 'Shape.+',
    nodeName: '+',
  })
  expect(page('Standard.Fixture')?.title).toBe('Standard.Fixture')
})

test('conversions get no page and are listed on the target type', () => {
  expect(model.conversions.get('Standard.Fixture.Shapes.Square')?.map((c) => c.source)).toEqual([
    'Standard.Base.Data.Numbers.Integer',
    'Standard.Base.Data.Text.Text',
  ])
})

test('extension methods are indexed by their self type', () => {
  expect(model.extensions.get('Standard.Fixture.Shapes.Shape')?.map((p) => p.path)).toEqual([
    'Standard.Fixture_Ext/Describe/Shape.describe',
  ])
})

test('the type index', () => {
  expect(model.types.get('Standard.Fixture.Shapes.Square')?.path).toBe(
    'Standard.Fixture/Shapes/Square',
  )
  expect(model.types.has('Standard.Base.Any.Any')).toBe(false)
})

test('the groups of every library, with or without a catalogue', () => {
  expect(model.groups.map((group) => `${group.project}.${group.name}`)).toEqual([
    'Standard.Fixture.Selections',
    'Standard.Fixture.Shaping',
  ])
})

test('function pages', () => {
  expect(model.pages.filter(isFunctionPage).length).toBe(9)
})

test('two entries with one path fail the run', () => {
  const libraries = readLibraries([FIXTURES_LIB])
  const fixture = libraries[0]!
  const duplicate = fixture.catalogue!.entries.find(
    (entry) => entry.type === 'method' && entry.name === 'area',
  )!
  const doubled: LibraryInput = {
    ...fixture,
    catalogue: {
      ...fixture.catalogue!,
      entries: [...fixture.catalogue!.entries, duplicate],
    },
  }
  expect(() => buildModel([doubled, libraries[1]!])).toThrow(
    /Standard\.Fixture\/Shapes\/Shape\.area/,
  )
})

test('paths that differ only in case are recorded', () => {
  const libraries = readLibraries([FIXTURES_LIB])
  const fixture = libraries[0]!
  const side = fixture.catalogue!.entries.find(
    (entry) => entry.type === 'method' && entry.name === 'side',
  )!
  const upper = { ...side, name: 'Side' }
  const withUpper: LibraryInput = {
    ...fixture,
    catalogue: {
      ...fixture.catalogue!,
      entries: [...fixture.catalogue!.entries, upper],
    },
  }
  expect(buildModel([withUpper, libraries[1]!]).caseCollisions).toEqual([
    ['Standard.Fixture/Shapes/Square.side', 'Standard.Fixture/Shapes/Square.Side'],
  ])
})

test('folders stay apart on a case-insensitive file system, and pages under a renamed folder follow it', () => {
  const dirs = new CaseSafeDirs()
  expect(
    [
      'L/Data/download',
      'L/Data/Download/Format',
      'L/Data/Download',
      'L/Data/DOWNLOAD',
      'L/Data/x',
    ].map((path) => dirs.dirOf(path)),
  ).toEqual([
    'L/Data/download',
    'L/Data/Download~1/Format',
    'L/Data/Download~1',
    'L/Data/DOWNLOAD~2',
    'L/Data/x',
  ])
})
