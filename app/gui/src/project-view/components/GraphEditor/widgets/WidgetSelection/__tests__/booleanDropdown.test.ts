/** @file A Boolean argument gets the ordinary dropdown. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import { hasDropdown } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { ApplicationKind, ArgumentInfoKey } from '@/util/callTree'
import { flushPromises } from '@vue/test-utils'
import { Ok } from 'enso-common/src/utilities/data/result'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const frame = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ExternalId
const BOOLEAN = 'Standard.Base.Data.Boolean.Boolean'
const booleanInput = { kind: 'Boolean_Input' } as never
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

  test('by its Boolean_Input configuration, without tag values', () => {
    expect(hasDropdown(argument({ reprType: BOOLEAN }, { dynamicConfig: booleanInput }))).toBe(true)
  })

  test('not by its declared type alone', () => {
    expect(hasDropdown(argument({ reprType: BOOLEAN }))).toBe(false)
  })

  describe('an argument with tag values', () => {
    const tagged = { tagValues: ['A', 'B'] }
    const defaults = new TypeDefaults(
      () => true,
      async () => Ok({ widget: { constructor: 'Text_Input' } }),
      (frame) => frame,
      'project',
    )
    let typeDefault: WidgetInput['dynamicConfig']
    beforeEach(async () => {
      defaults.lookup('T', frame)
      await flushPromises()
      typeDefault = defaults.lookup('T', frame)
    })
    afterAll(() => defaults.dispose())

    test('keeps its dropdown under a type default (until the kind picker)', () => {
      expect(typeDefault).toBeDefined()
      expect(hasDropdown(argument(tagged, { dynamicConfig: typeDefault }))).toBe(true)
    })

    test('loses it to an annotation of the same kind', () => {
      for (const kind of ['Text_Input', 'Numeric_Input', 'Time_Input', 'Date_Time_Input'] as const)
        expect(hasDropdown(argument(tagged, { dynamicConfig: { kind } as never }))).toBe(false)
    })

    test('without a configuration keeps it', () => {
      expect(hasDropdown(argument(tagged))).toBe(true)
    })
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
