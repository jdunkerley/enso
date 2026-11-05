import { returnTypeInfo } from '@/components/ComponentBrowser/returnTypeInfo'
import { stdPath } from '@/util/projectPath'
import { expect, test } from 'vitest'

const table = 'Standard.Base.Data.Table.Table'
const any = 'Standard.Base.Any.Any'

test('a plain return type', () => {
  expect(returnTypeInfo(table)?.visibleTypes).toEqual([stdPath(table)])
})

test('an intersection keeps every operand, the first as the primary type', () => {
  const info = returnTypeInfo(`${table} & ${any}`)
  expect(info?.primaryType).toEqual(stdPath(table))
  expect(info?.visibleTypes).toEqual([stdPath(table), stdPath(any)])
})

test('a chain of intersections', () => {
  expect(returnTypeInfo(`${table} & ${any} & Standard.Base.Data.Text.Text`)?.visibleTypes).toEqual([
    stdPath(table),
    stdPath(any),
    stdPath('Standard.Base.Data.Text.Text'),
  ])
})

test('an applied type is a value of its head type', () => {
  const info = returnTypeInfo(`(Standard.Base.Data.Vector.Vector ${table}) & ${any}`)
  expect(info?.visibleTypes).toEqual([stdPath('Standard.Base.Data.Vector.Vector'), stdPath(any)])
})

test('a union gives no type information', () => {
  expect(returnTypeInfo(`${table} | ${any}`)).toBeUndefined()
  expect(
    returnTypeInfo(`(${table} & Standard.Database.DB_Table.DB_Table) | ${any}`),
  ).toBeUndefined()
  expect(returnTypeInfo(`(${table} | ${any})`)).toBeUndefined()
})

test('an operand that is a union or a function is skipped', () => {
  const info = returnTypeInfo(`(${table} | ${any}) & Standard.Base.Data.Text.Text`)
  expect(info?.visibleTypes).toEqual([stdPath('Standard.Base.Data.Text.Text')])
  expect(returnTypeInfo(`(${table} -> ${any}) & ${table}`)?.visibleTypes).toEqual([stdPath(table)])
})

test('unparseable return types give no type info', () => {
  expect(returnTypeInfo('A -> B')).toBeUndefined()
})
