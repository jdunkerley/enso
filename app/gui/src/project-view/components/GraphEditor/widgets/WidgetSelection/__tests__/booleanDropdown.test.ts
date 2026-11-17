/** @file A Boolean argument gets the ordinary dropdown. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { hasDropdown } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { ApplicationKind, ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'

const BOOLEAN = 'Standard.Base.Data.Boolean.Boolean'
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

describe('a Boolean argument has a dropdown', () => {
  test('by its True/False tag values (the checkbox took these before)', () => {
    expect(hasDropdown(argument({ tagValues: ['True', 'False'] }))).toBe(true)
  })

  test('by its type, without tag values', () => {
    expect(hasDropdown(argument({ reprType: BOOLEAN }))).toBe(true)
    expect(hasDropdown(argument({}, { expectedType: BOOLEAN as never }))).toBe(true)
  })

  test('by a literal value of an untyped argument', () => {
    expect(hasDropdown(argument({}, { value: Ast.parseExpression('False')! }))).toBe(true)
  })

  test('not while its dynamic configuration is pending', () => {
    expect(
      hasDropdown(argument({ reprType: BOOLEAN }, { dynamicConfig: { kind: 'Pending' } as never })),
    ).toBe(false)
  })

  test('an infix operand has none', () => {
    const operand = argument({ reprType: BOOLEAN }, { value: Ast.parseExpression('True')! })
    operand[ArgumentInfoKey]!.appKind = ApplicationKind.Infix
    expect(hasDropdown(operand)).toBe(false)
  })

  test('a literal that is not an argument has none', () => {
    expect(hasDropdown(WidgetInput.FromAst(Ast.parseExpression('True')!))).toBe(false)
  })
})
