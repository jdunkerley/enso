import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import { removeWarningsPattern } from '@/components/visualizations/warningsNodes'
import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { describe, expect, test } from 'vitest'
import { ref } from 'vue'
import { nodeExpressionPattern } from '../JSONVisualization/treeExpression'
import { brushFilterPattern, rowPattern } from '../ScatterplotVisualization/scatterNodes'
import { columnValueToEnso } from '../TableVisualization/columnValueToEnso'
import { valueNodePattern, type ValueNodeAction } from '../TableVisualization/tableContextMenu'
import type { GridFilterModel } from '../TableVisualization/tableVizFilterUtils'
import { useTableVizToolbar, type SortModel } from '../TableVisualization/tableVizToolbar'
import { isActionButton } from '../toolbar'

// The gate of piece 3 (docs/superpowers/specs/2026-11-14-viz-actions-design.md, "Verification"):
// the exact text of the node each visualisation gesture creates. The table's links are pinned by
// `tableViewSnapshot.test.ts`. Moving the gestures onto Enso-described actions must leave this
// snapshot unchanged; only the DRIVERS block below changes when the code paths do.

/** The node the visualised value comes from. */
const SOURCE_NODE = 'operator1'

function text(pattern: Pattern | undefined): string | undefined {
  return pattern?.instantiateCopied([Ast.parseExpression(SOURCE_NODE)!]).code()
}

/** The column types of the table the toolbar cases filter. */
const COLUMN_TYPES = new Map<string, string>([
  ['a', 'Integer'],
  ['f', 'Float'],
  ['b', 'Char'],
  ['d', 'Date'],
  ['t', 'Time'],
  ['dt', 'Date_Time'],
  ['m', 'Mixed'],
  ['bo', 'Boolean'],
])

interface ToolbarCase {
  sorts?: SortModel[]
  filters?: GridFilterModel[]
  hidden?: string[]
  order?: string[] | null
}

const filter = (f: Partial<GridFilterModel> & Pick<GridFilterModel, 'columnName' | 'filterType'>) =>
  f as GridFilterModel

const TOOLBAR_CASES: Record<string, ToolbarCase> = {
  'sort by one column': {
    sorts: [{ columnName: 'a', sortDirection: 'asc', sortIndex: 0 }],
  },
  'sort by two columns': {
    sorts: [
      { columnName: 'b', sortDirection: 'desc', sortIndex: 1 },
      { columnName: 'a', sortDirection: 'asc', sortIndex: 0 },
    ],
  },
  'number equals': {
    filters: [
      filter({
        columnName: 'a',
        filterType: 'number',
        filterAction: 'equals',
        filter: '3',
      }),
    ],
  },
  'number in range': {
    filters: [
      filter({
        columnName: 'a',
        filterType: 'number',
        filterAction: 'inRange',
        filter: '1',
        filterTo: '5',
      }),
    ],
  },
  'float greater than': {
    filters: [
      filter({
        columnName: 'f',
        filterType: 'number',
        filterAction: 'greaterThan',
        filter: '2.5',
      }),
    ],
  },
  'set of one': {
    filters: [filter({ columnName: 'b', filterType: 'set', values: ['x'] })],
  },
  'set of two': {
    filters: [filter({ columnName: 'b', filterType: 'set', values: ['x', 'y'] })],
  },
  'set of dates': {
    filters: [
      filter({
        columnName: 'd',
        filterType: 'set',
        values: ['2024-01-02', '2024-02-03'],
      }),
    ],
  },
  // KNOWN DEFECT, issue #785: the recorded text `..Equal Time_Of_Day.parse ('10:30:00')` is not
  // parenthesised, so Enso reads it as `Equal` with two arguments. This entry (and the single
  // date-time one below) pins today's text on purpose; do not "correct" the snapshot. It changes
  // when #785 is fixed, after PR 3.2.
  'set of a time': {
    filters: [filter({ columnName: 't', filterType: 'set', values: ['10:30:00'] })],
  },
  'set of one date-time (known defect, #785)': {
    filters: [filter({ columnName: 'dt', filterType: 'set', values: ['2024-01-02 10:30:00'] })],
  },
  'set of a date-time': {
    filters: [
      filter({
        columnName: 'dt',
        filterType: 'set',
        values: ['2024-01-02 10:30:00', '2024-01-03 11:00:00'],
      }),
    ],
  },
  'set of a mixed value': {
    filters: [filter({ columnName: 'm', filterType: 'set', values: ['12'] })],
  },
  'set of a boolean': {
    filters: [filter({ columnName: 'bo', filterType: 'set', values: ['false'] })],
  },
  'set of a boolean, true': {
    filters: [filter({ columnName: 'bo', filterType: 'set', values: ['true'] })],
  },
  ...Object.fromEntries(
    (['notEqual', 'greaterThanOrEqual', 'lessThanOrEqual'] as const).map((filterAction) => [
      `number ${filterAction}`,
      {
        filters: [filter({ columnName: 'a', filterType: 'number', filterAction, filter: '3' })],
      },
    ]),
  ),
  ...Object.fromEntries(
    (['notEqual', 'startsWith', 'endsWith'] as const).map((filterAction) => [
      `text ${filterAction}`,
      {
        filters: [filter({ columnName: 'b', filterType: 'text', filterAction, filter: 'ab' })],
      },
    ]),
  ),
  ...Object.fromEntries(
    (['notEqual', 'greaterThan', 'lessThan'] as const).map((filterAction) => [
      `date ${filterAction}`,
      {
        filters: [
          filter({
            columnName: 'd',
            filterType: 'date',
            filterAction,
            dateFrom: '2024-01-02 00:00:00',
          }),
        ],
      },
    ]),
  ),
  'text contains': {
    filters: [
      filter({
        columnName: 'b',
        filterType: 'text',
        filterAction: 'contains',
        filter: 'ab',
      }),
    ],
  },
  blank: {
    filters: [filter({ columnName: 'b', filterType: 'text', filterAction: 'blank' })],
  },
  'not blank': {
    filters: [filter({ columnName: 'b', filterType: 'text', filterAction: 'notBlank' })],
  },
  'date equals': {
    filters: [
      filter({
        columnName: 'd',
        filterType: 'date',
        filterAction: 'equals',
        dateFrom: '2024-01-02 00:00:00',
      }),
    ],
  },
  'two filters in one node': {
    filters: [
      filter({
        columnName: 'a',
        filterType: 'number',
        filterAction: 'greaterThan',
        filter: '1',
      }),
      filter({
        columnName: 'b',
        filterType: 'text',
        filterAction: 'contains',
        filter: 'x',
      }),
    ],
  },
  'hidden columns': { hidden: ['b', 'd'] },
  'reordered columns': { order: ['b', 'a', 'd'] },
  'everything at once': {
    sorts: [{ columnName: 'a', sortDirection: 'desc', sortIndex: 0 }],
    filters: [
      filter({
        columnName: 'a',
        filterType: 'number',
        filterAction: 'lessThan',
        filter: '10',
      }),
      filter({ columnName: 'b', filterType: 'set', values: ['x', 'y'] }),
    ],
    hidden: ['d'],
    order: ['b', 'a'],
  },
}

/** Collects the text of each node `createNodes` is asked for. */
function capture(created: string[]) {
  return (...options: NodeCreationOptions[]) => {
    for (const option of options) created.push(text(option.content)!)
  }
}

// ---- DRIVERS: how the code makes each gesture's node. PRs 3.2 and 3.3 replace this block. ----

/** The nodes the table toolbar's "create components" button makes. */
function toolbarNodes(c: ToolbarCase): string[] {
  const created: string[] = []
  const items = useTableVizToolbar({
    textFormatterSelected: ref('partial'),
    filterModel: c.filters ?? [],
    sortModel: c.sorts ?? [],
    tableFilteredOrSorted: true,
    isCreateNewNodeEnabled: true,
    createNodes: capture(created),
    getColumnValueToEnso: columnValueToEnso(COLUMN_TYPES),
    hiddenColumns: c.hidden ?? [],
    vizColumnOrder: c.order ?? null,
    refreshGrid: () => {},
  })
  const button = items.value.find(
    (item) => isActionButton(item) && item.icon === 'add_to_graph_editor',
  )
  if (button == null || !isActionButton(button)) throw new Error('no create-components button')
  button.onClick()
  return created
}

/** The node of a table right-click menu item, on a table with the clicked cell at `column`, `row`. */
function menuNode(
  column: string | null,
  row: number | null,
  item: 'Get Column' | 'Get Row' | 'Get Value',
) {
  const action: ValueNodeAction =
    item === 'Get Column' ? 'at'
    : item === 'Get Row' ? 'get_row'
    : 'get_value'
  return text(valueNodePattern(column, row, action))
}

/** The scatter plot's "create component of selected points" node on a table. */
function brushNode(
  series: string[],
  x: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
) {
  return text(brushFilterPattern(series, x, minX, maxX, minY, maxY))
}

/** A double-clicked scatter point's node, on a table (`table`) or a vector (`vector`). */
function pointNode(row: number, value: 'table' | 'vector') {
  return text(rowPattern(row, value === 'table' ? 'get_row' : 'at'))
}

/** The Warnings visualisation's "remove warnings" node. */
function removeWarningsNode() {
  return text(removeWarningsPattern())
}

/** A tree entry's node, from its chain of node expressions. */
function treeNode(chain: string[]) {
  return text(nodeExpressionPattern(chain))
}

/** The nodes of the tree's "all siblings" gesture, from the chain of each sibling entry. */
function treeNodes(chains: string[][]) {
  return chains.flatMap((chain) => nodeExpressionPattern(chain) ?? []).map(text)
}

// ---- end of DRIVERS ----

describe('Table toolbar: create components', () => {
  test.each(Object.entries(TOOLBAR_CASES))('%s', (_, c) => {
    expect(toolbarNodes(c)).toMatchSnapshot()
  })
})

describe('Table toolbar: filters the toolbar cannot build', () => {
  // A Date column offers `inRange`, but the range falls through to the single-value branch of
  // `buildFilterExpression`, which formats an object as a date string: clicking the button throws.
  // Pinned as a throw, not a snapshot. PR 3.2.3 may fix it on purpose; then this test changes.
  test('date in range throws a TypeError', () => {
    const c: ToolbarCase = {
      filters: [
        filter({
          columnName: 'd',
          filterType: 'date',
          filterAction: 'inRange',
          dateFrom: '2024-01-02 00:00:00',
          dateTo: '2024-02-03 00:00:00',
        }),
      ],
    }
    expect(() => toolbarNodes(c)).toThrow(TypeError)
  })
})

describe('Table right-click menu, on a table', () => {
  test.each([
    ['Get Column', 'Get Column', 'b', 2],
    ['Get Row', 'Get Row', 'b', 2],
    ['Get Value', 'Get Value', 'b', 2],
    ['Get Row at row 0', 'Get Row', 'b', 0],
    ['Get Value at row 0', 'Get Value', 'b', 0],
    // The row-number column is a real column, with the id `#` (`INDEX_FIELD_NAME`). Right-clicking
    // it builds these nodes, which are probably broken (no table has a column `#`): recorded as is.
    ['Get Column on the row-number column', 'Get Column', '#', 2],
    ['Get Value on the row-number column', 'Get Value', '#', 2],
    ['Get Column with no column under the click', 'Get Column', null, 2],
    ['Get Value with no column under the click', 'Get Value', null, 2],
  ] as const)('%s', (title, item, column, row) => {
    expect(menuNode(column, row, item)).toMatchSnapshot()
  })
})

describe('Scatter plot', () => {
  test('brush, one series', () => {
    expect(brushNode(['y'], 'x', 0, 10, -1.5, 3)).toMatchSnapshot()
  })
  test('brush, two series', () => {
    expect(brushNode(['y', 'z'], 'x', 1, 2, 3, 4)).toMatchSnapshot()
  })
  test('point of a table', () => {
    expect(pointNode(3, 'table')).toMatchSnapshot()
  })
  test('point of a vector', () => {
    expect(pointNode(3, 'vector')).toMatchSnapshot()
  })
})

describe('Warnings', () => {
  test('remove warnings', () => {
    expect(removeWarningsNode()).toMatchSnapshot()
  })
})

describe('Tree', () => {
  test.each([
    ['a key', [".get 'tags'"]],
    ['a key then an index', [".get 'tags'", '.at 1']],
    ['a table row value', ['.rows', '.at 0', ".at 'x'"]],
    ['a table summary entry', ['.row_count']],
    ['an XML attribute', [".at '@id'"]],
  ] as const)('%s', (_, chain) => {
    expect(treeNode([...chain])).toMatchSnapshot()
  })

  // The gesture with all the sibling entries (`activate(row, all = true)` in `JSONVisualization.vue`):
  // one node per chain, in order, dropping those that are not method calls.
  test('all the siblings, one of them not a method call', () => {
    expect(
      treeNodes([[".get 'a'"], ['not a method call'], [".get 'b'", '.at 1'], ['.row_count']]),
    ).toMatchSnapshot()
  })
})
