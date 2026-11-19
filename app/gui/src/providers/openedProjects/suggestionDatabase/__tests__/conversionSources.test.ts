import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import { assert, expect, test } from 'vitest'

test('conversionSources maps a target type to the sources of its `from` conversions', () => {
  const db = SuggestionDb.createMock([
    // The language server reports a conversion as a non-static method of its target type.
    makeMethod('Standard.Visualization.Viz_Table.Viz_Table.from', {
      args: [makeArgument('that', 'Standard.Table.Table.Table')],
    }),
    // A static `from` is not a conversion.
    makeMethod('Standard.Visualization.Viz_Table.Viz_Table.from', {
      isStatic: true,
      args: [makeArgument('that', 'Standard.Base.Data.Vector.Vector')],
    }),
    makeMethod('Standard.Visualization.Viz_Table.Viz_Table.other', {
      args: [makeArgument('that', 'Standard.Base.Data.Text.Text')],
    }),
  ])
  const target = parseAbsoluteProjectPathRaw('Standard.Visualization.Viz_Table.Viz_Table')
  const source = parseAbsoluteProjectPathRaw('Standard.Table.Table.Table')
  assert(target.ok && source.ok)
  expect(db.conversionSources.lookup(target.value.key())).toEqual(new Set([source.value.key()]))
})

test('a conversion from a type object is keyed on `….Foo.type`, apart from Foo values', () => {
  const db = SuggestionDb.createMock([
    // `W.from (that : Foo.type)`: the engine reports the source as `….Foo.type`.
    makeMethod('local.Proj.W.W.from', {
      args: [makeArgument('that', 'local.Proj.Foo.Foo.type')],
    }),
  ])
  const target = parseAbsoluteProjectPathRaw('local.Proj.W.W')
  const typeSource = parseAbsoluteProjectPathRaw('local.Proj.Foo.Foo.type')
  const valueSource = parseAbsoluteProjectPathRaw('local.Proj.Foo.Foo')
  assert(target.ok && typeSource.ok && valueSource.ok)
  const sources = db.conversionSources.lookup(target.value.key())
  expect(sources).toEqual(new Set([typeSource.value.key()]))
  expect(sources?.has(valueSource.value.key())).toBe(false)
})
