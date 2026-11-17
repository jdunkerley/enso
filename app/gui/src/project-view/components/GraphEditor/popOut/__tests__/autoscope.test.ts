import { Ast } from '@/util/ast'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { describe, expect, test } from 'vitest'
import { qualifyAutoscoped } from '../autoscope'

const DATE_PERIOD = 'Standard.Base.Data.Time.Date_Period.Date_Period'
const PERIOD = 'Standard.Base.Data.Time.Period.Period'
const ctors: Record<string, string[]> = {
  [DATE_PERIOD]: ['Year', 'Month', 'Week', 'Day'],
  [PERIOD]: ['Value'],
}
const has = (t: string, n: string) => ctors[t]?.includes(n) ?? false

function parse(code: string) {
  return Ast.parseExpression(code)!
}

describe('qualifyAutoscoped', () => {
  test('a bare auto-scoped value', () => {
    const e = parse('..Month')
    expect(qualifyAutoscoped(e, new Map([[e.id, DATE_PERIOD]]), has)).toEqual(
      Ok('Date_Period.Month'),
    )
  })
  test('the head of an application, typed at the application', () => {
    const e = parse('..Week Day_Of_Week.Sunday')
    expect(qualifyAutoscoped(e, new Map([[e.id, DATE_PERIOD]]), has)).toEqual(
      Ok('Date_Period.Week Day_Of_Week.Sunday'),
    )
  })
  test('a union picks the member with the constructor', () => {
    const e = parse('..Month')
    expect(qualifyAutoscoped(e, new Map([[e.id, `${PERIOD} | ${DATE_PERIOD}`]]), has)).toEqual(
      Ok('Date_Period.Month'),
    )
  })
  test('nested, typed by the argument it sits in', () => {
    const e = parse('d.up_to e step=..Month')
    let id: Ast.AstId | undefined
    Ast.visitRecursive(e, (a) => {
      if (a instanceof Ast.AutoscopedIdentifier) id = a.id
      return true
    })
    expect(qualifyAutoscoped(e, new Map([[id!, DATE_PERIOD]]), has)).toEqual(
      Ok('d.up_to e step=Date_Period.Month'),
    )
  })
  test('no expected type: Err with the name', () => {
    const e = parse('..Month')
    expect(qualifyAutoscoped(e, new Map(), has)).toEqual(Err('..Month'))
  })
  test('no auto-scoped names: the code unchanged', () => {
    const e = parse('Date.new 2020 1 15')
    expect(qualifyAutoscoped(e, new Map(), has)).toEqual(Ok('Date.new 2020 1 15'))
  })
})
