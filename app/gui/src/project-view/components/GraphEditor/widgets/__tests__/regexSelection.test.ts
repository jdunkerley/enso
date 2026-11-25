/**
 * @file A `Regex` argument outside a union with `tagValues` of its own: the values' dropdown
 * (`WidgetSelection`, 50) wraps the regex input (`WidgetRegex`, 102). An argument's own `tagValues`
 * win over a type default (owner decision D1 on #919), and the regex input still draws the value
 * inside the dropdown. An annotation's `Regex_Input` is not a type default, so the regex input alone.
 */
import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { WidgetInput, WidgetRegistry } from '$/providers/openedProjects/widgetRegistry'
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import * as regexModule from '@/components/GraphEditor/widgets/WidgetRegex.vue'
import * as selectionModule from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { expect, test } from 'vitest'
import { typeDefaultConfig } from './typeDefaultFixture'

const REGEX_TYPE = 'Standard.Base.Data.Text.Regex.Regex'

function regexArgument(dynamicConfig: WidgetConfiguration, value: string | undefined): WidgetInput {
  return {
    ...(value != null ?
      WidgetInput.FromAst(Ast.parseExpression(value)!)
    : { portId: 'port' as WidgetInput['portId'], value: undefined }),
    dynamicConfig,
    [ArgumentInfoKey]: {
      appKind: 0,
      info: {
        name: 'pattern',
        reprType: REGEX_TYPE,
        isSuspended: false,
        hasDefault: false,
        tagValues: ["regex '[0-9]+'", "regex '[a-z]+'"],
      },
    },
  } as WidgetInput
}

const registry = new WidgetRegistry(GraphDb.Mock())
registry.registerWidgetModule(regexModule)
registry.registerWidgetModule(selectionModule)
const select = (input: WidgetInput, alreadyUsed?: Set<unknown>) =>
  registry.select({ input, nesting: 0 }, alreadyUsed as never)

test.each([undefined, "regex '[0-9]+'", "regex 'x'"])(
  'the tag values dropdown wraps the regex input, value %s',
  async (value) => {
    const input = regexArgument(await typeDefaultConfig('Regex_Input'), value)
    expect(select(input)).toBe(selectionModule)
    expect(select(input, new Set([selectionModule.default]))).toBe(regexModule)
  },
)

test("an annotation's Regex_Input is the regex input alone", () => {
  expect(select(regexArgument({ kind: 'Regex_Input' }, "regex 'x'"))).toBe(regexModule)
})
