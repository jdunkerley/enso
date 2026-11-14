import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import { assert, expect, test } from 'vitest'

test('conversionSources maps a target type to the sources of its `from` conversions', () => {
  const db = SuggestionDb.createMock([
    makeMethod('Standard.Visualization.Viz_Table.Viz_Table.from', {
      isStatic: true,
      args: [makeArgument('that', 'Standard.Table.Table.Table')],
    }),
    makeMethod('Standard.Visualization.Viz_Table.Viz_Table.other', {
      isStatic: true,
      args: [makeArgument('that', 'Standard.Base.Data.Vector.Vector')],
    }),
  ])
  const target = parseAbsoluteProjectPathRaw('Standard.Visualization.Viz_Table.Viz_Table')
  const source = parseAbsoluteProjectPathRaw('Standard.Table.Table.Table')
  assert(target.ok && source.ok)
  expect(db.conversionSources.lookup(target.value.key())).toEqual(new Set([source.value.key()]))
})
