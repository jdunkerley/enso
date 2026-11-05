import { returnTypeInfo } from '@/components/ComponentBrowser/returnTypeInfo'
import { stdPath } from '@/util/projectPath'
import { expect, test } from 'vitest'

const table = 'Standard.Base.Data.Table.Table'

test('a plain return type', () => {
  expect(returnTypeInfo(table)?.visibleTypes).toEqual([stdPath('Standard.Base.Data.Table.Table')])
})

test('an intersection keeps every operand, the first as the primary type', () => {
  const info = returnTypeInfo(`${table} & Standard.Base.Any.Any`)
  expect(info?.primaryType).toEqual(stdPath('Standard.Base.Data.Table.Table'))
  expect(info?.visibleTypes).toEqual([
    stdPath('Standard.Base.Data.Table.Table'),
    stdPath('Standard.Base.Any.Any'),
  ])
})

test('unparseable return types give no type info', () => {
  expect(returnTypeInfo('A -> B')).toBeUndefined()
})
