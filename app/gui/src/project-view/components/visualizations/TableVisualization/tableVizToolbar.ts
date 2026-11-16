import type { ToValue } from '$/utils/reactivity'
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import type { ToolbarItem } from '@/components/visualizations/toolbar'
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { computed, type ComputedRef, type Ref, toValue } from 'vue'
import type { Expression, MutableExpression } from 'ydoc-shared/ast'
import type { TextFormatOptions } from '../TableVisualization.vue'
import { actionPattern, chainPattern, findAction, type VizAction } from '../vizActions'
import {
  actionMap,
  type FilterAction,
  type FilterType,
  type FilterValueRange,
  getFilterValue,
  type GridFilterModel,
} from './tableVizFilterUtils'

type SortDirection = 'asc' | 'desc'
export type SortModel = {
  columnName: string
  sortDirection: SortDirection
  sortIndex: number
}

export interface SortFilterNodesButtonOptions {
  filterModel: ToValue<GridFilterModel[]>
  sortModel: ToValue<SortModel[]>
  actions: ToValue<readonly VizAction[]>
  createNodes: (...options: NodeCreationOptions[]) => void
  getColumnValueToEnso: (
    columnName: string,
  ) => (columnValue: string, module: Ast.MutableModule) => Ast.Owned<Ast.MutableAst>
}

export interface FormatMenuOptions {
  textFormatterSelected: Ref<TextFormatOptions>
}

export interface ColumnNodeButton {
  actions: ToValue<readonly VizAction[]>
  createNodes: (...options: NodeCreationOptions[]) => void
  hiddenColumns: ToValue<string[]>
  vizColumnOrder: ToValue<string[] | null>
}

interface NewNodeOptions extends SortFilterNodesButtonOptions, ColumnNodeButton {
  tableFilteredOrSorted: ToValue<boolean>
}

export interface RefreshButtonOptions {
  refreshGrid: () => void
  tableFilteredOrSorted: ToValue<boolean>
}

export interface Options extends NewNodeOptions, FormatMenuOptions, RefreshButtonOptions {}

/** The actions the toolbar's "create components" button understands. */
export const TABLE_TOOLBAR_ACTIONS = [
  'sort',
  'filter',
  'remove_columns',
  'reorder_columns',
] as const

/**
 * The toolbar's "create components" button: it makes a node of the grid's filters, one of its
 * sort, and one each of the hidden and the reordered columns, each from the action Enso offers for
 * it (an action the value does not offer makes no node). The button is there when the value offers
 * any of {@link TABLE_TOOLBAR_ACTIONS}, and `undefined` otherwise.
 */
function useSortFilterNodesButton({
  filterModel,
  sortModel,
  tableFilteredOrSorted,
  actions,
  createNodes,
  getColumnValueToEnso,
  hiddenColumns,
  vizColumnOrder,
}: NewNodeOptions): ComputedRef<ToolbarItem | undefined> {
  const sortSpecPattern = Pattern.parseExpression('(..Name __ __ )')!
  const conditionPattern = Pattern.parseExpression('(__ __)')!
  const betweenPattern = Pattern.parseExpression('(..Between __ __)')!

  const sortDirection = { asc: '..Ascending', desc: '..Descending' }

  /** The condition of one grid filter, as the filter action's `{{condition}}`: `(..Equal 3)`. */
  function conditionBuilder(
    columnName: string,
    filterType: FilterType,
    filterAction: FilterAction | undefined,
    value?: string[] | string | FilterValueRange,
  ) {
    const valueFormatter = getColumnValueToEnso(columnName)
    return (module: Ast.MutableModule): Ast.Owned<Ast.MutableExpression> => {
      if (filterAction === 'blank' || filterAction === 'notBlank') {
        return Ast.parseExpression(actionMap[filterAction], module)!
      }
      if (filterType === 'set') {
        if (Array.isArray(value) && value.length === 1) {
          return conditionPattern.instantiateCopied([
            Ast.parseExpression('..Equal')!,
            valueFormatter(value[0]!, module) as Expression | MutableExpression,
          ])
        }
        return conditionPattern.instantiateCopied([
          Ast.parseExpression('..Is_In')!,
          Ast.Vector.build(
            value as string[],
            (element, tempModule) => valueFormatter(element, tempModule),
            module,
          ),
        ])
      }
      if (filterType === 'number' && filterAction === 'inRange' && typeof value === 'object') {
        const { fromValue, toValue } = value as FilterValueRange
        return betweenPattern.instantiateCopied([
          valueFormatter(fromValue, module) as Expression | MutableExpression,
          valueFormatter(toValue, module) as Expression | MutableExpression,
        ])
      }
      return conditionPattern.instantiateCopied([
        Ast.parseExpression(actionMap[filterAction!])!,
        valueFormatter(value as string, module) as Expression | MutableExpression,
      ])
    }
  }

  function createNewNodes() {
    const offered = toValue(actions)
    const filters = toValue(filterModel)
    const sorts = toValue(sortModel)
    const patterns: Pattern[] = []

    const filterAction = findAction(offered, 'filter')
    const filterNode =
      filterAction && filters.length ?
        chainPattern(
          filters.map((filter) => ({
            template: filterAction.template,
            values: {
              column: filter.columnName,
              condition: conditionBuilder(
                filter.columnName,
                filter.filterType,
                filter.filterAction,
                getFilterValue(filter),
              ),
            },
          })),
          { firstSpaced: true },
        )
      : undefined

    const sortAction = findAction(offered, 'sort')
    if (sortAction && sorts.length > 0) {
      const columns = sorts
        .filter((s) => s?.columnName)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map(
          (sort) => (module: Ast.MutableModule) =>
            sortSpecPattern.instantiateCopied(
              [
                Ast.TextLiteral.new(sort.columnName),
                Ast.parseExpression(sortDirection[sort.sortDirection as SortDirection])!,
              ],
              module,
            ),
        )
      const pattern = actionPattern(sortAction, { columns })
      if (pattern) patterns.push(pattern)
    }

    const removeAction = findAction(offered, 'remove_columns')
    const columnsToRemove = toValue(hiddenColumns)
    if (removeAction && columnsToRemove.length) {
      const pattern = actionPattern(removeAction, { columns: columnsToRemove })
      if (pattern) patterns.push(pattern)
    }

    const reorderAction = findAction(offered, 'reorder_columns')
    const columnOrder = toValue(vizColumnOrder)
    if (reorderAction && columnOrder?.length) {
      const pattern = actionPattern(reorderAction, { columns: columnOrder })
      if (pattern) patterns.push(pattern)
    }

    createNodes(
      ...(filterNode ? [filterNode] : []).map(
        (content) => ({ content, commit: true }) satisfies NodeCreationOptions,
      ),
    )
    createNodes(
      ...patterns.map((content) => ({ content, commit: true }) satisfies NodeCreationOptions),
    )
  }

  const createNodesButton: ToolbarItem = {
    icon: 'add_to_graph_editor',
    title: "Create new component(s) with the current grid's state applied to the workflow",
    disabled: computed(() => !toValue(tableFilteredOrSorted)),
    onClick: createNewNodes,
  }

  return computed(() =>
    TABLE_TOOLBAR_ACTIONS.some((id) => findAction(toValue(actions), id)) ? createNodesButton : (
      undefined
    ),
  )
}

function createFormatMenu({ textFormatterSelected }: FormatMenuOptions): ToolbarItem {
  return {
    selected: textFormatterSelected,
    title: 'Text Display Options',
    options: {
      full: {
        icon: 'paragraph',
        iconStyle: {
          stroke: 'black',
          color: 'black',
        },
        title:
          'Text displayed in monospace font and all whitespace characters displayed as symbols',
        label: 'Full whitespace rendering',
      },
      partial: {
        icon: 'paragraph',
        iconStyle: {
          stroke: '#525252',
          color: '#525252',
        },
        title: 'Text displayed in monospace font, only multiple spaces displayed with "\xB7"',
        label: 'Partial whitespace rendering',
      },
      off: {
        icon: 'not_paragraph',
        title: 'No formatting applied to text',
        label: 'No whitespace rendering',
      },
    },
  }
}

function createRefreshMenu({
  refreshGrid,
  tableFilteredOrSorted,
}: RefreshButtonOptions): ToolbarItem {
  return {
    title: 'Reset any sort, filter or column changes made to the table',
    icon: 'undo',
    disabled: computed(() => !toValue(tableFilteredOrSorted)),
    onClick: refreshGrid,
  }
}

/** TODO: Add docs */
export function useTableVizToolbar(options: Options): ComputedRef<ToolbarItem[]> {
  const createNodesButton = useSortFilterNodesButton(options)
  const formatMenu = createFormatMenu(options)
  const refreshButton = createRefreshMenu(options)
  return computed(() => [
    formatMenu,
    ...(createNodesButton.value ? [createNodesButton.value] : []),
    refreshButton,
  ])
}
