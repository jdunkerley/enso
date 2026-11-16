import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import { columnValueToEnso } from '../columnValueToEnso'

function written(columnType: string, item: string) {
  const module = Ast.MutableModule.Transient()
  return columnValueToEnso(new Map([['c', columnType]]))('c')(item, module).code()
}

// Each value is one argument wherever it is placed (`..Equal <value>`), so a value that is a
// method call must be grouped (#785).
test.each([
  ['Time', '10:30:00', "(Time_Of_Day.parse '10:30:00')"],
  ['Date_Time', '2024-01-02 10:30:00', "(Date_Time.parse '2024-01-02 10:30:00')"],
  ['Date', '2024-01-02', '(Date.new 2024 1 2)'],
])('a %s value is written as one grouped expression', (columnType, item, expected) => {
  expect(written(columnType, item)).toBe(expected)
})
