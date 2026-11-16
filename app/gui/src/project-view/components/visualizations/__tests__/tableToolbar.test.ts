import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import { ref } from 'vue'
import { columnValueToEnso } from '../TableVisualization/columnValueToEnso'
import type { GridFilterModel } from '../TableVisualization/tableVizFilterUtils'
import {
  TABLE_TOOLBAR_ACTIONS,
  useTableVizToolbar,
  type SortModel,
} from '../TableVisualization/tableVizToolbar'
import { isActionButton } from '../toolbar'
import type { VizAction } from '../vizActions'

// The toolbar's node text is pinned by `vizNodeTextSnapshot.test.ts`, which is the full gate; these
// cases check that the toolbar follows the actions the value offers, with the text of a few of them.

const chain = (id: string, template: string): VizAction => ({
  id,
  label: id,
  icon: '',
  kind: 'chain',
  template,
})

/** The table actions, as the table goldens send them. */
const TABLE_ACTIONS: VizAction[] = [
  chain('sort', 'sort {{columns*}}'),
  chain('filter', 'filter {{@column}} {{condition}}'),
  chain('remove_columns', 'remove_columns {{@columns*}}'),
  chain('reorder_columns', 'reorder_columns {{@columns*}}'),
]

const COLUMN_TYPES = new Map([
  ['a', 'Integer'],
  ['b', 'Char'],
  ['d', 'Date'],
])

interface State {
  sorts?: SortModel[]
  filters?: GridFilterModel[]
  hidden?: string[]
  order?: string[] | null
}

/** The nodes the "create components" button makes, `undefined` when the toolbar has no button. */
function created(actions: VizAction[], state: State): string[] | undefined {
  const nodes: string[] = []
  const toolbar = useTableVizToolbar({
    textFormatterSelected: ref('partial'),
    filterModel: state.filters ?? [],
    sortModel: state.sorts ?? [],
    tableFilteredOrSorted: true,
    actions,
    createNodes: (...options: NodeCreationOptions[]) => {
      for (const option of options) {
        nodes.push(option.content.instantiateCopied([Ast.parseExpression('operator1')!]).code())
      }
    },
    getColumnValueToEnso: columnValueToEnso(COLUMN_TYPES),
    hiddenColumns: state.hidden ?? [],
    vizColumnOrder: state.order ?? null,
    refreshGrid: () => {},
  })
  const button = toolbar.value.find(
    (item) => isActionButton(item) && item.icon === 'add_to_graph_editor',
  )
  if (button == null || !isActionButton(button)) return undefined
  button.onClick()
  return nodes
}

const filter = (f: Partial<GridFilterModel> & Pick<GridFilterModel, 'columnName' | 'filterType'>) =>
  f as GridFilterModel

const EVERYTHING: State = {
  sorts: [{ columnName: 'a', sortDirection: 'desc', sortIndex: 0 }],
  filters: [
    filter({ columnName: 'a', filterType: 'number', filterAction: 'lessThan', filter: '10' }),
    filter({ columnName: 'b', filterType: 'set', values: ['x', 'y'] }),
  ],
  hidden: ['d'],
  order: ['b', 'a'],
}

describe('The table toolbar, from the value actions', () => {
  test('the actions are the four the button understands', () => {
    expect(TABLE_TOOLBAR_ACTIONS).toEqual(['sort', 'filter', 'remove_columns', 'reorder_columns'])
  })

  test('with every action it makes the filter node, then sort, remove and reorder', () => {
    expect(created(TABLE_ACTIONS, EVERYTHING)).toEqual([
      "operator1 . filter 'a' (..Less 10) . filter 'b' (..Is_In ['x', 'y'])",
      "operator1.sort [(..Name 'a' ..Descending )]",
      "operator1.remove_columns ['d']",
      "operator1.reorder_columns ['b', 'a']",
    ])
  })

  test('there is no button when the value offers none of them', () => {
    expect(created([], EVERYTHING)).toBeUndefined()
    expect(created([chain('open_row', 'get_row {{#index}}')], EVERYTHING)).toBeUndefined()
  })

  test('an action the value does not offer makes no node', () => {
    const all = created(TABLE_ACTIONS, EVERYTHING)!
    const without = (missing: string) =>
      created(
        TABLE_ACTIONS.filter((action) => action.id !== missing),
        EVERYTHING,
      )
    expect(without('filter')).toEqual(all.slice(1))
    expect(without('sort')).toEqual([all[0], all[2], all[3]])
    expect(without('remove_columns')).toEqual([all[0], all[1], all[3]])
    expect(without('reorder_columns')).toEqual(all.slice(0, 3))
  })

  test('nothing to apply makes no node', () => {
    expect(created(TABLE_ACTIONS, {})).toEqual([])
  })

  test('a filter the builder cannot write makes no node, and does not throw', () => {
    // A date range has no condition the Date column's value formatter can write.
    const nodes = created(TABLE_ACTIONS, {
      filters: [
        filter({
          columnName: 'd',
          filterType: 'date',
          filterAction: 'inRange',
          dateFrom: '2024-01-02 00:00:00',
          dateTo: '2024-02-03 00:00:00',
        }),
      ],
    })
    expect(nodes).toEqual([])
  })
})
