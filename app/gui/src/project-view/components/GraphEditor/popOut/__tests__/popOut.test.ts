import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { describe, expect, test } from 'vitest'
import { canPopOut, popOutCode } from '../popOut'

const DATE_PERIOD = 'Standard.Base.Data.Time.Date_Period.Date_Period'
const has = (t: string, n: string) => t === DATE_PERIOD && n === 'Month'
const noInfo = { getMethodCallInfo: (): MethodCallInfo | undefined => undefined }

function argInput(value: Ast.Ast | string | undefined): WidgetInput {
  return {
    value,
    [ArgumentInfoKey]: { info: { name: 'end' }, appKind: 0, argId: undefined },
  } as WidgetInput
}

describe('canPopOut', () => {
  test.each([
    ['Date.new 2020 1 15', true],
    ['..Month', true],
    ['42', true],
    ['date1', false],
    ['_', false],
  ])('canPopOut(%s) is %s', (code, expected) => {
    expect(canPopOut(argInput(Ast.parseExpression(code)!))).toBe(expected)
  })

  test('false for a non-argument', () => {
    expect(canPopOut(WidgetInput.FromAst(Ast.parseExpression('Date.today')!))).toBe(false)
  })

  test('false for a placeholder', () => {
    expect(canPopOut(argInput('end'))).toBe(false)
    expect(canPopOut(argInput(undefined))).toBe(false)
  })
})

describe('popOutCode', () => {
  test('qualifies the root', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, DATE_PERIOD, noInfo, has)).toEqual(Ok('Date_Period.Month'))
  })
  test('an unresolved name is an error', () => {
    const e = Ast.parseExpression('..Month')!
    expect(popOutCode(e, undefined, noInfo, has)).toEqual(Err('..Month'))
  })
  test('plain code is unchanged', () => {
    const e = Ast.parseExpression('Date.new 2020 1 15')!
    expect(popOutCode(e, undefined, noInfo, has)).toEqual(Ok('Date.new 2020 1 15'))
  })
})
