import type {
  UnionKind,
  WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { kindIcon } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindIcon'
import { iconNames } from '@/util/iconMetadata/iconName'
import { expect, test } from 'vitest'

const kind = (label: string, config: WidgetConfiguration | null): UnionKind => ({ label, config })

/* eslint-disable camelcase */
const cases: [string, UnionKind, string | undefined][] = [
  ['Nothing', kind('Nothing', null), undefined],
  ['File_Browse', kind('Writable_File', { kind: 'File_Browse' }), 'document'],
  ['Folder_Browse', kind('Folder', { kind: 'Folder_Browse' }), 'folder'],
  ['Secret_Browse', kind('Secret', { kind: 'Secret_Browse' }), 'key'],
  [
    'Vector_Editor',
    kind('Vector', {
      kind: 'Vector_Editor',
      item_editor: { kind: 'Text_Input' },
      item_default: "''",
    }),
    'array_new',
  ],
  ['Regex_Input', kind('Regex', { kind: 'Regex_Input' }), 'regex'],
  ['Text_Input', kind('Text', { kind: 'Text_Input' }), 'text_input'],
  ['Boolean_Input', kind('Boolean', { kind: 'Boolean_Input' }), 'toggle'],
  ['Date_Input', kind('Date', { kind: 'Date_Input' }), 'calendar'],
  ['Time_Input', kind('Time_Of_Day', { kind: 'Time_Input' }), 'time'],
  ['Date_Time_Input', kind('Date_Time', { kind: 'Date_Time_Input' }), 'datetime'],
  ['Integer', kind('Integer', { kind: 'Numeric_Input' }), 'input_number'],
  ['Positive_Integer', kind('Positive_Integer', { kind: 'Numeric_Input' }), 'input_number'],
  ['Float', kind('Float', { kind: 'Numeric_Input' }), 'input_decimal'],
  ['Number', kind('Number', { kind: 'Numeric_Input' }), 'input_decimal'],
  ['Single_Choice', kind('Choice', { kind: 'Single_Choice', values: [] }), undefined],
]

/* eslint-enable camelcase */

test.each(cases)('%s', (_name, k, expected) => {
  expect(kindIcon(k)).toBe(expected)
  if (expected !== undefined) expect(iconNames).toContain(expected)
})
