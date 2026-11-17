import { expect, test } from 'vitest'
import { canonicalVisualizationId } from '../movedVisualizations'

test('the old builtin Image id is read as the library one', () => {
  expect(canonicalVisualizationId({ module: { kind: 'Builtin' }, name: 'Image' })).toEqual({
    module: { kind: 'Library', name: 'Standard.Image' },
    name: 'Image',
  })
})

test('other ids are unchanged', () => {
  const table = { module: { kind: 'Builtin' }, name: 'Table' } as const
  expect(canonicalVisualizationId(table)).toBe(table)
})

test('the old builtin SQL Query id is read as the Standard.Database one', () => {
  expect(canonicalVisualizationId({ module: { kind: 'Builtin' }, name: 'SQL Query' })).toEqual({
    module: { kind: 'Library', name: 'Standard.Database' },
    name: 'SQL Query',
  })
})

test('the old builtin Geo Map id is read as the Standard.Visualization one', () => {
  expect(canonicalVisualizationId({ module: { kind: 'Builtin' }, name: 'Geo Map' })).toEqual({
    module: { kind: 'Library', name: 'Standard.Visualization' },
    name: 'Geo Map',
  })
})
