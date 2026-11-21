/** @file Which inputs are Booleans, and the dropdown's entries. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'
import { ApplicationKind, ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import {
  BOOLEAN_TYPE,
  booleanExpressionTags,
  booleanFromCode,
  booleanLiteral,
  isBooleanArgument,
  setBooleanLiteral,
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

describe('isBooleanArgument and infix operands', () => {
  test('an infix operand is not a Boolean argument, however it is typed', () => {
    const value = Ast.parseExpression('True')!
    const prefix = argument({ reprType: BOOLEAN_TYPE, tagValues: ['True', 'False'] }, { value })
    expect(isBooleanArgument(prefix)).toBe(true)
    const infix = argument({ reprType: BOOLEAN_TYPE, tagValues: ['True', 'False'] }, { value })
    infix[ArgumentInfoKey]!.appKind = ApplicationKind.Infix
    expect(isBooleanArgument(infix)).toBe(false)
  })
})

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

  test('an argument configured Boolean_Input', () => {
    expect(isBooleanArgument(argument({}, { dynamicConfig: { kind: 'Boolean_Input' } }))).toBe(true)
  })

  test('a declared Boolean type without the configuration is not one', () => {
    expect(isBooleanArgument(argument({ reprType: BOOLEAN_TYPE }))).toBe(false)
    expect(isBooleanArgument(argument({}, { expectedType: BOOLEAN_TYPE as never }))).toBe(false)
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

describe('setBooleanLiteral', () => {
  function flip(code: string, value: boolean) {
    const module = Ast.MutableModule.Transient()
    const ast = Ast.parseExpression(code, module)!
    const result = setBooleanLiteral(ast, value)
    return { ...result, code: ast.code() }
  }

  test.each([
    ['True', false, 'False', true],
    ['False', true, 'True', true],
    ['Boolean.True', false, 'Boolean.False', false],
    ['Boolean.False', true, 'Boolean.True', false],
    [
      'Standard.Base.Data.Boolean.Boolean.False',
      true,
      'Standard.Base.Data.Boolean.Boolean.True',
      false,
    ],
  ])('%s set to %s becomes %s (requiresImport %s)', (code, value, expected, requiresImport) => {
    expect(flip(code, value)).toEqual({ code: expected, requiresImport })
  })
})
