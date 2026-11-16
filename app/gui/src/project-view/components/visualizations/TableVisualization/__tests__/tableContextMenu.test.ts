import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import { assertDefined } from 'ydoc-shared/util/assert'
import type { VizAction } from '../../vizActions'
import { tableMenuEntries } from '../tableContextMenu'

const chain = (id: string, label: string, icon: string, template: string): VizAction => ({
  id,
  label,
  icon,
  kind: 'chain',
  template,
})

const TABLE = [
  chain('open_row', 'Get Row', 'select_row', 'get_row {{#index}}'),
  chain('open_column', 'Get Column', 'select_column', 'at {{@column}}'),
  chain('open_cell', 'Get Value', 'select_cell', 'get_value {{@column}} {{#index}}'),
  chain('sort', 'Sort', '', 'sort {{columns*}}'),
]

function texts(entries: ReturnType<typeof tableMenuEntries>) {
  const source = Ast.parseExpression('operator1')
  assertDefined(source)
  return entries.map((e) => `${e.name}: ${e.pattern.instantiateCopied([source]).code()}`)
}

describe('tableMenuEntries', () => {
  test('a table cell: column, row and value, by the row number', () => {
    // Display row 0 after a sort holds the table's row 2: the menu uses `#`, not the display index.
    expect(
      texts(
        tableMenuEntries(TABLE, { action: 'get_row {{#index}}' }, 'b', {
          '#': 2,
          b: 'x',
        }),
      ),
    ).toEqual([
      "Get Column: operator1.at 'b'",
      'Get Row: operator1.get_row 2',
      "Get Value: operator1.get_value 'b' 2",
    ])
  })

  test('the row-number column offers only the row', () => {
    expect(texts(tableMenuEntries(TABLE, undefined, '#', { '#': 2 }))).toEqual([
      'Get Row: operator1.get_row 2',
    ])
  })

  test('no column under the click offers only the row', () => {
    expect(texts(tableMenuEntries(TABLE, undefined, null, { '#': 2 }))).toEqual([
      'Get Row: operator1.get_row 2',
    ])
  })

  test('no row under the click offers only the column', () => {
    expect(texts(tableMenuEntries(TABLE, undefined, 'b', null))).toEqual([
      "Get Column: operator1.at 'b'",
    ])
  })

  test('a vector offers its item', () => {
    const vector = [chain('open_row', 'Get Item', 'select_row', 'at {{#index}}')]
    expect(
      texts(tableMenuEntries(vector, { action: 'at {{#index}}' }, '0', { '#': 1, '0': 5 })),
    ).toEqual(['Get Item: operator1.at 1'])
  })

  test('the entries keep the action’s icon', () => {
    expect(tableMenuEntries(TABLE, undefined, 'b', { '#': 2 }).map((entry) => entry.icon)).toEqual([
      'select_column',
      'select_row',
      'select_cell',
    ])
  })

  test('a value with only a link offers the link', () => {
    expect(
      texts(
        tableMenuEntries([], { action: 'query {{@Table}}', label: 'table' }, 'Table', {
          '#': 0,
          Table: 'pinned',
        }),
      ),
    ).toEqual(["Open This Table: operator1.query 'pinned'"])
  })

  test('a link without a label is named after the value', () => {
    expect(texts(tableMenuEntries([], { action: 'at {{#index}}' }, 'x', { '#': 4 }))).toEqual([
      'Open This Value: operator1.at 4',
    ])
  })

  test('a link is left out when the value offers a row action', () => {
    expect(
      texts(tableMenuEntries(TABLE, { action: 'query {{@Table}}' }, '#', { '#': 0, Table: 'a' })),
    ).toEqual(['Get Row: operator1.get_row 0'])
  })

  test('a link is left out when the row lacks a value it reads', () => {
    expect(tableMenuEntries([], { action: 'query {{@Table}}' }, 'Table', { '#': 0 })).toEqual([])
  })

  test('nothing applies: no entries', () => {
    expect(tableMenuEntries([], undefined, 'b', { '#': 0, b: 1 })).toEqual([])
  })
})
