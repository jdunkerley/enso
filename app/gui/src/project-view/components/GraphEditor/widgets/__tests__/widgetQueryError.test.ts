import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as iconWidget } from '@/components/GraphEditor/widgets/WidgetIcon.vue'
import { widgetDefinition as portWidget } from '@/components/GraphEditor/widgets/WidgetPort.vue'
import { widgetDefinition as errorWidget } from '@/components/GraphEditor/widgets/WidgetQueryError.vue'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { WidgetQueryErrorKey } from '@/util/callTree'
import { expect, test } from 'vitest'

test('takes only an input whose widget query failed', () => {
  const input = WidgetInput.FromAst(Ast.parseExpression('x')!)
  expect(errorWidget.match(input)).toBe(false)
  expect(
    errorWidget.match({
      ...input,
      [WidgetQueryErrorKey]: { step: 'annotation', message: 'boom' },
    }),
  ).toBe(true)
})

test('wraps the argument inside its port and outside the widgets that draw it', () => {
  expect(errorWidget.priority).toBeGreaterThan(portWidget.priority)
  expect(errorWidget.priority).toBeGreaterThan(iconWidget.priority)
  expect(errorWidget.priority).toBeLessThan(selectionWidget.priority)
})
