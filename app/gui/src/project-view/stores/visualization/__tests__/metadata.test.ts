import { fc, test } from '@fast-check/vitest'
import { assert, expect } from 'vitest'

import {
  fromVisualizationId,
  toVisualizationId,
  VisualizationMetadataDb,
  visualizationsForTypes,
} from '@/stores/visualization/metadata'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

test.prop({
  kind: fc.oneof(
    fc.constant<'Builtin'>('Builtin'),
    fc.constant<'CurrentProject'>('CurrentProject'),
    fc.constant<'Library'>('Library'),
  ),
  libraryName: fc.string(),
  name: fc.string(),
})(
  '`toVisualizationId` and `fromVisualizationId` can be round-tripped',
  ({ kind, libraryName, name }) => {
    const ident: VisualizationIdentifier = {
      module: kind === 'Library' ? { kind, name: libraryName } : { kind },
      name,
    }
    const id = toVisualizationId(ident)
    const reconstructedIdent = fromVisualizationId(id)
    expect(ident).toEqual(reconstructedIdent)
    expect(id).toEqual(toVisualizationId(reconstructedIdent))
  },
)

function makePath(ident: string): string {
  return 'Standard.Base.' + ident
}

test('metadata index', () => {
  const db = new VisualizationMetadataDb()
  const a = toVisualizationId({ module: { kind: 'Builtin' }, name: 'a' })
  const b = toVisualizationId({ module: { kind: 'Builtin' }, name: 'b' })
  db.set(a, { name: 'a', inputType: 'Standard.Base.B | Standard.Base.C' })
  db.set(b, { name: 'b', inputType: 'Standard.Base.C | Standard.Base.D | Standard.Base.E' })
  expect(db.visualizationIdToType.lookup(a)).toEqual(new Set([makePath('B'), makePath('C')]))
  expect(db.visualizationIdToType.lookup(b)).toEqual(
    new Set([makePath('C'), makePath('D'), makePath('E')]),
  )
  expect(db.visualizationIdToType.reverseLookup(makePath('B'))).toEqual(new Set([a]))
  expect(db.visualizationIdToType.reverseLookup(makePath('C'))).toEqual(new Set([a, b]))
  expect(db.visualizationIdToType.reverseLookup(makePath('D'))).toEqual(new Set([b]))
  expect(db.visualizationIdToType.reverseLookup(makePath('E'))).toEqual(new Set([b]))

  db.delete(b)
  expect(db.visualizationIdToType.lookup(a)).toEqual(new Set([makePath('B'), makePath('C')]))
  expect(db.visualizationIdToType.lookup(b)).toEqual(new Set())
  expect(db.visualizationIdToType.reverseLookup(makePath('B'))).toEqual(new Set([a]))
  expect(db.visualizationIdToType.reverseLookup(makePath('C'))).toEqual(new Set([a]))
  expect(db.visualizationIdToType.reverseLookup(makePath('D'))).toEqual(new Set())
  expect(db.visualizationIdToType.reverseLookup(makePath('E'))).toEqual(new Set())
})

test('a visualization with a data type is offered for types that convert to it', () => {
  const db = new VisualizationMetadataDb()
  const scatter = toVisualizationId({ module: { kind: 'Builtin' }, name: 'Scatter Plot' })
  const table = toVisualizationId({ module: { kind: 'Builtin' }, name: 'Table' })
  db.set(scatter, { name: 'Scatter Plot', dataType: 'Standard.Visualization.Viz_Table.Viz_Table' })
  db.set(table, { name: 'Table', inputType: 'Standard.Base.Any.Any' })
  const vizTable = parseAbsoluteProjectPathRaw('Standard.Visualization.Viz_Table.Viz_Table')
  const tableType = parseAbsoluteProjectPathRaw('Standard.Table.Table.Table')
  const any = parseAbsoluteProjectPathRaw('Standard.Base.Any.Any')
  const intType = parseAbsoluteProjectPathRaw('Standard.Base.Data.Numbers.Integer')
  assert(vizTable.ok && tableType.ok && any.ok && intType.ok)
  const sources = (target: string) =>
    target === vizTable.value.key() ? new Set([tableType.value.key(), any.value.key()]) : undefined

  expect(visualizationsForTypes(db, [tableType.value.key()], sources)).toEqual([table, scatter])
  // The `Any` catch-all does not offer a chart for every value.
  expect(visualizationsForTypes(db, [intType.value.key()], sources)).toEqual([table])
})
