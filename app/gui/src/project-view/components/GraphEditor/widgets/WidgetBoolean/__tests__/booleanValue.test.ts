/** @file Which inputs are Booleans, and the dropdown's entries. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import {
  BOOLEAN_TYPE,
  booleanExpressionTags,
  booleanFromCode,
  booleanLiteral,
  isBooleanArgument,
} from '../booleanValue'

const argument = (
  info: { reprType?: string; tagValues?: string[] },
  extra: Partial<WidgetInput> = {},
): WidgetInput =>
  ({
    portId: 'port' as WidgetInput['portId'],
    value: undefined,
    [ArgumentInfoKey]: {
      appKind: 0,
      info: {
        name: 'keep',
        reprType: 'Standard.Base.Any.Any',
        isSuspended: false,
        hasDefault: true,
        ...info,
      },
    },
    ...extra,
  }) as WidgetInput

describe('booleanFromCode', () => {
  test.each([
    ['True', true],
    ['False', false],
    ['Boolean.True', true],
    ['Boolean.False', false],
    ['Standard.Base.Data.Boolean.Boolean.True', true],
    [' False ', false],
  ])('%s is %s', (code, value) => {
    expect(booleanFromCode(code)).toBe(value)
  })

  test.each([undefined, '', 'true', 'x', 'a && True', 'Other.True'])(
    '%s is not a Boolean literal',
    (code) => {
      expect(booleanFromCode(code)).toBeUndefined()
    },
  )
})

describe('booleanLiteral', () => {
  test('an AST literal', () => {
    expect(booleanLiteral(Ast.parseExpression('True')!)).toBe(true)
    expect(booleanLiteral(Ast.parseExpression('Boolean.False')!)).toBe(false)
  })

  test('not a literal', () => {
    expect(booleanLiteral(Ast.parseExpression('a > b')!)).toBeUndefined()
    expect(booleanLiteral(Ast.parseExpression('flag')!)).toBeUndefined()
    expect(booleanLiteral(undefined)).toBeUndefined()
  })
})

describe('isBooleanArgument', () => {
  test('tag values True and False, in any order', () => {
    expect(isBooleanArgument(argument({ tagValues: ['True', 'False'] }))).toBe(true)
    expect(isBooleanArgument(argument({ tagValues: ['False', 'True'] }))).toBe(true)
  })

  test('a Boolean reprType or expected type', () => {
    expect(isBooleanArgument(argument({ reprType: BOOLEAN_TYPE }))).toBe(true)
    expect(isBooleanArgument(argument({}, { expectedType: BOOLEAN_TYPE as never }))).toBe(true)
  })

  test('an untyped argument whose value is a literal', () => {
    expect(isBooleanArgument(argument({}, { value: Ast.parseExpression('True')! }))).toBe(true)
  })

  test('an argument with its own options keeps them, whatever its value', () => {
    expect(
      isBooleanArgument(
        argument({ tagValues: ['A', 'B'] }, { value: Ast.parseExpression('True')! }),
      ),
    ).toBe(false)
    expect(
      isBooleanArgument(
        argument(
          {},
          {
            value: Ast.parseExpression('True')!,
            dynamicConfig: { kind: 'Single_Choice' } as never,
          },
        ),
      ),
    ).toBe(false)
  })

  test('not an argument, or another type', () => {
    expect(isBooleanArgument(WidgetInput.FromAst(Ast.parseExpression('True')!))).toBe(false)
    expect(isBooleanArgument(argument({ reprType: 'Standard.Base.Data.Text.Text' }))).toBe(false)
    expect(isBooleanArgument(argument({ tagValues: ['True', 'False', 'Nothing'] }))).toBe(false)
  })
})

describe('booleanExpressionTags', () => {
  test('True then False, labelled by their code', () => {
    const db = {
      getEntryByProjectPath: () => undefined,
    } as unknown as Parameters<typeof booleanExpressionTags>[0]
    const tags = booleanExpressionTags(db)
    expect(tags.map((tag) => tag.expression)).toEqual(['True', 'False'])
    expect(tags.map((tag) => tag.label)).toEqual(['True', 'False'])
  })
})
