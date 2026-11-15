import {
  makeArgument,
  makeModuleMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { docArguments, widgetKind } from '@/components/ComponentHelp/arguments'
import { expect, test } from 'vitest'

const DOC = [
  'Counts the working days.',
  '',
  '## Arguments',
  '- `end`: The last day.',
  '- `include_end_date`: Count `end` too.',
].join('\n')

test('docArguments merges types and defaults from code with descriptions from the doc', () => {
  const entry = makeModuleMethod('Standard.Base.Data.Time.Date.work_days_until', {
    args: [
      makeArgument('self', 'Standard.Base.Data.Time.Date.Date'),
      makeArgument('end', 'Standard.Base.Data.Time.Date.Date'),
      {
        ...makeArgument('holidays', 'Standard.Base.Data.Vector.Vector'),
        hasDefault: true,
        defaultValue: '[]',
      },
      {
        ...makeArgument('include_end_date', 'Standard.Base.Data.Boolean.Boolean'),
        hasDefault: true,
        defaultValue: 'False',
      },
    ],
    documentation: DOC,
  })
  const args = docArguments(entry)
  expect(args.map((a) => a.name)).toEqual(['end', 'holidays', 'include_end_date'])
  expect(args[0]).toMatchObject({
    type: 'Date',
    default: undefined,
    optional: false,
    description: 'The last day.',
    widget: 'type',
    widgetInferred: true,
  })
  expect(args[1]).toMatchObject({
    type: 'Vector',
    default: '[]',
    optional: true,
    description: '',
  })
  expect(args[2]).toMatchObject({
    widget: 'checkbox',
    description: 'Count `end` too.',
  })
})

test('widgetKind: tag values make a dropdown, an annotation a custom widget', () => {
  const period = {
    ...makeArgument('period', 'Standard.Base.Data.Time.Date_Period.Date_Period'),
    tagValues: ['..Day'],
  }
  expect(widgetKind(period, false)).toBe('dropdown')
  expect(widgetKind(makeArgument('format', 'Standard.Base.Data.Text.Text'), true)).toBe('custom')
  expect(widgetKind(makeArgument('n', 'Standard.Base.Data.Numbers.Integer'), false)).toBe('number')
  expect(
    widgetKind(
      makeArgument('s', 'Standard.Base.Data.Text.Text | Standard.Base.Nothing.Nothing'),
      false,
    ),
  ).toBe('text')
})
