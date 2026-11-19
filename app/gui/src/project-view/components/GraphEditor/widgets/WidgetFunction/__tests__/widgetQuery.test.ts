import {
  RESOLVE_CALL_POINTER,
  WIDGET_QUERY_MODULE,
} from '@/components/GraphEditor/widgets/WidgetFunction/consts'
import {
  resolveCallArguments,
  widgetQueryConfiguration,
} from '@/components/GraphEditor/widgets/WidgetFunction/widgetQuery'
import { expect, test } from 'vitest'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const target = {
  module: 'Standard.Table.Table',
  definedOnType: 'Standard.Table.Table.Table',
  name: 'join',
}

test('the arguments are literals only, so they compile in any module', () => {
  expect(resolveCallArguments(target, ['on', 'right'], { right: 'id-1' }, false)).toEqual([
    "'Standard.Table.Table'",
    "'Standard.Table.Table.Table'",
    "'join'",
    "['on', 'right']",
    `'{"right":"id-1"}'`,
    'False',
  ])
})

test('a call with no subject expression asks for the type as the subject', () => {
  expect(resolveCallArguments(target, ['on'], {}, true).at(-1)).toBe('True')
})

test('the query is a method pointer to Widget_Query.resolve_call, evaluated in its own module', () => {
  const config = widgetQueryConfiguration('id-0' as ExternalId, target, ['on'], {}, false)
  expect(config.expressionId).toBe('id-0')
  expect(config.visualizationModule).toBe(WIDGET_QUERY_MODULE)
  expect(config.expression).toEqual(RESOLVE_CALL_POINTER)
})
