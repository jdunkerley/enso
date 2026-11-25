import type {
  UnionKind,
  WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { kindIcon } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindIcon'
import { iconNames } from '@/util/iconMetadata/iconName'
import { expect, test } from 'vitest'

const kind = (label: string, config: WidgetConfiguration | null): UnionKind => ({ label, config })

/* eslint-disable camelcase */
const cases: [UnionKind, string | undefined][] = [
  [kind('Nothing', null), undefined],
  [kind('Writable_File', { kind: 'File_Browse', file_types: [] }), 'document'],
  [kind('Folder', { kind: 'Folder_Browse' }), 'folder'],
  [kind('Secret', { kind: 'Secret_Browse' }), 'key'],
  [
    kind('Vector', {
      kind: 'Vector_Editor',
      item_editor: { kind: 'Text_Input' },
      item_default: "''",
    }),
    'array_new',
  ],
  [kind('Regex', { kind: 'Regex_Input' }), 'regex'],
  [kind('Text', { kind: 'Text_Input' }), 'text_input'],
  [kind('Boolean', { kind: 'Boolean_Input' }), 'toggle'],
  [kind('Date', { kind: 'Date_Input' }), 'calendar'],
  [kind('Time_Of_Day', { kind: 'Time_Input' }), 'time'],
  [kind('Date_Time', { kind: 'Date_Time_Input' }), 'datetime'],
  [kind('Integer', { kind: 'Numeric_Input' }), 'input_number'],
  [kind('Positive_Integer', { kind: 'Numeric_Input' }), 'input_number'],
  [kind('Float', { kind: 'Numeric_Input' }), 'input_decimal'],
  [kind('Number', { kind: 'Numeric_Input' }), 'input_decimal'],
  [kind('Choice', { kind: 'Single_Choice', values: [] }), undefined],
]

/* eslint-enable camelcase */

// The title names what decides the icon: the widget kind, and for a number the kind's label too.
test.each(
  cases.map(([k, expected]) => ({
    title: `${k.label} (${k.config?.kind ?? 'Nothing'}) → ${expected ?? 'no icon, the label'}`,
    k,
    expected,
  })),
)('$title', ({ k, expected }) => {
  expect(kindIcon(k)).toBe(expected)
  if (expected !== undefined) expect(iconNames).toContain(expected)
})
