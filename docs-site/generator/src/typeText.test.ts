import { expect, test } from 'vitest'
import { simpleName, unqualifiedType } from './typeText'

test.each([
  ['Standard.Table.Table.Table & Standard.Base.Any.Any', 'Table & Any'],
  [
    'Standard.Table.Column.Column | Standard.Table.Expression.Expression | Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer',
    'Column | Expression | Text | Integer',
  ],
  [
    'Standard.Base.Data.Filter_Condition.Filter_Condition | (Standard.Base.Any.Any -> Standard.Base.Data.Boolean.Boolean)',
    'Filter_Condition | (Any -> Boolean)',
  ],
  ['Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text', 'Vector Text'],
  ['Any', 'Any'],
])('%s → %s', (type, expected) => {
  expect(unqualifiedType(type)).toBe(expected)
})

test('simpleName', () => {
  expect(simpleName('Standard.Table.Table.Table')).toBe('Table')
  expect(simpleName('Table')).toBe('Table')
})
