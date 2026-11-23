import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { widgetDefinition as errorWidget } from '@/components/GraphEditor/widgets/WidgetQueryError.vue'
import WidgetQueryNote, {
  widgetDefinition as noteWidget,
} from '@/components/GraphEditor/widgets/WidgetQueryNote.vue'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { WidgetQueryNoteKey } from '@/util/callTree'
import { expect, test } from 'vitest'

test('takes only an input with a note', () => {
  const input = WidgetInput.FromAst(Ast.parseExpression('x')!)
  expect(noteWidget.match(input)).toBe(false)
  expect(noteWidget.match({ ...input, [WidgetQueryNoteKey]: { kind: 'loading' } })).toBe(true)
})

test('wraps the argument after the error marker and outside the widgets that draw it', () => {
  expect(noteWidget.priority).toBeGreaterThan(errorWidget.priority)
  expect(noteWidget.priority).toBeLessThan(selectionWidget.priority)
})

async function mountNote(note: NonNullable<WidgetInput[typeof WidgetQueryNoteKey]>) {
  const { wrapper } = await mountWithProviders(WidgetQueryNote, {
    props: {
      input: { portId: 'port', value: undefined, [WidgetQueryNoteKey]: note },
      updateCallback: () => ({ ok: true }),
      nesting: 0,
    } as never,
    global: { stubs: { NodeWidget: { template: '<span data-testid="inner" />' } } },
  })
  return wrapper
}

test('an unavailable note names the dependency, and the argument is still drawn', async () => {
  const wrapper = await mountNote({ kind: 'unavailable', dependency: 'right', message: 'bad' })
  const marker = wrapper.get('[data-testid="widget-query-note-unavailable"]')
  expect(marker.attributes('aria-label')).toContain('right')
  expect(wrapper.find('[data-testid="inner"]').exists()).toBe(true)
})

test('a loading note says so', async () => {
  const wrapper = await mountNote({ kind: 'loading' })
  expect(wrapper.get('[data-testid="widget-query-note-loading"]').attributes('aria-label')).toMatch(
    /Loading/,
  )
})
