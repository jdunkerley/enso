import { COLUMNS_METHOD } from '@/composables/tableColumns'
import { expect, test } from 'vitest'

test("the column names come from the table view's module, not Widgets", () => {
  expect(COLUMNS_METHOD.module.path).toBe('Table.Visualization')
  expect(COLUMNS_METHOD.definedOnType.path).toBe('Table.Visualization')
  expect(COLUMNS_METHOD.name).toBe('column_names_json')
})
