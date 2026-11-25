/** @file Which of the number and text widgets draws an input both could take. */
import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { WidgetInput, WidgetRegistry } from '$/providers/openedProjects/widgetRegistry'
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import * as numberModule from '@/components/GraphEditor/widgets/WidgetNumber.vue'
import * as textModule from '@/components/GraphEditor/widgets/WidgetText.vue'
import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'

const placeholder: WidgetInput = { portId: 'port' as WidgetInput['portId'], value: undefined }
const literal = (code: string) => WidgetInput.FromAst(Ast.parseExpression(code)!)

test.each([
  ['a text literal under an annotated Numeric_Input', literal("'abc'"), 'Numeric_Input', 'text'],
  ['a number literal under an annotated Text_Input', literal('42'), 'Text_Input', 'number'],
  ['an unset Numeric_Input argument', placeholder, 'Numeric_Input', 'number'],
  ['an unset Text_Input argument', placeholder, 'Text_Input', 'text'],
] as const)(
  '%s is drawn by the %4$s widget, whichever registered first',
  (_, input, kind, widget) => {
    const expected = widget === 'text' ? textModule : numberModule
    const dynamicConfig = { kind } as WidgetConfiguration
    for (const order of [
      [numberModule, textModule],
      [textModule, numberModule],
    ]) {
      const registry = new WidgetRegistry(GraphDb.Mock())
      for (const module of order) registry.registerWidgetModule(module)
      expect(registry.select({ input: { ...input, dynamicConfig }, nesting: 0 })).toBe(expected)
    }
  },
)
