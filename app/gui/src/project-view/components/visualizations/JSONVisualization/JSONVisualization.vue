<script lang="ts">
export const name = 'JSON'
export const icon = 'braces'
export const inputType = 'Standard.Base.Any.Any'
export const defaultPreprocessor = ['Standard.Visualization.Tree', 'prepare'] as const
</script>

<script setup lang="ts">
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import GridPopupMenu from '@/components/GridPopupMenu.vue'
import {
  menuIconHtml,
  type GridMenuItem,
} from '@/components/shared/AgGridTableView/gridPopupMenuItems'
import {
  entryMenu,
  siblingChains,
  useLazyTree,
  type TreeRow,
} from '@/components/visualizations/JSONVisualization/lazyTree'
import {
  childrenExpression,
  nodeExpressionPattern,
} from '@/components/visualizations/JSONVisualization/treeExpression'
import {
  parsePageResult,
  parsePrepared,
  type PageResult,
  type TreeKey,
} from '@/components/visualizations/JSONVisualization/treeWire'
import TreeRowView from '@/components/visualizations/JSONVisualization/TreeRow.vue'
import {
  isNavigable,
  rowKey,
  treeKeyAction,
} from '@/components/visualizations/JSONVisualization/treeKeys'
import { parseVizActions, plainActionToolbar } from '@/components/visualizations/vizActions'
import { stopCopy } from '@/util/shortcuts'
import { useVisualizationConfig } from '@/util/visualizationBuiltins'
import { useEventListener, useVirtualList } from '@vueuse/core'
import { computed, nextTick, shallowRef, watch } from 'vue'

const { data } = defineProps<{ data: unknown }>()
const config = useVisualizationConfig()

/** A row's height in pixels: the virtual list needs it fixed. */
const ROW_HEIGHT_PX = 20

async function fetchPage(
  path: readonly TreeKey[],
  start: number,
  count: number,
): Promise<PageResult> {
  const response = await config.executeExpression(childrenExpression(path, start, count))
  // `null` while the visualization subdoc syncs; `undefined` when there is no node to evaluate on
  // (a component browser preview).
  if (response == null) return { ok: false, message: 'the value is not available here' }
  if (!response.ok) return { ok: false, message: String(response.error.payload) }
  return parsePageResult(response.value)
}

config.setToolbar(computed(() => plainActionToolbar(parseVizActions(data), config.createNodes)))

const prepared = computed(() => parsePrepared(data))
const tree = useLazyTree(fetchPage)
/**
 * The open menu, where it was asked for. `row` is the key of its entry; `keyboard` is set when the
 * keyboard asked for it, which then holds the focus until it closes and gives it back to the entry.
 */
const menu = shallowRef<{
  point: { x: number; y: number }
  items: GridMenuItem[]
  row: string
  keyboard: boolean
}>()
/** The key of the row last focused: the tree's one tab stop (see `tabStopKey`). */
const activeKey = shallowRef<string>()
watch(
  prepared,
  (value) => {
    // The menu holds chains made for the old payload.
    menu.value = undefined
    tree.setRoot(value)
  },
  { immediate: true },
)

const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(tree.rows, {
  itemHeight: ROW_HEIGHT_PX,
  overscan: 10,
})

/**
 * The row that is reached with Tab: the one last focused, or the first of those shown if that has
 * scrolled away (the virtual list drops it) or there is none yet. The other rows are reached with
 * the arrow keys.
 */
const tabStopKey = computed(() => {
  const shown = list.value.map(({ data }) => data).filter(isNavigable)
  return (
    shown.find((row) => rowKey(row) === activeKey.value) != null ? activeKey.value
    : shown[0] != null ? rowKey(shown[0])
    : undefined
  )
})

/** Creates a node for each chain that makes one. */
function createNodesFor(chains: readonly (readonly string[])[]) {
  const patterns = chains.flatMap((chain) => nodeExpressionPattern(chain) ?? [])
  if (patterns.length === 0) return
  config.createNodes(
    ...patterns.map((content) => ({ content, commit: true }) satisfies NodeCreationOptions),
  )
}

function activate(row: TreeRow, all: boolean) {
  if (row.kind !== 'entry' || row.chain == null) return
  createNodesFor(all ? siblingChains(tree.rows.value, row) : [row.chain])
}

function openMenu(row: TreeRow, point: { x: number; y: number }, keyboard: boolean) {
  const entries = entryMenu(tree.rows.value, row)
  menu.value =
    entries.length === 0 ?
      undefined
    : {
        point,
        row: rowKey(row),
        keyboard,
        items: entries.map(({ name, icon, chains }) => ({
          type: 'item',
          name,
          icon: menuIconHtml(icon),
          action: () => createNodesFor(chains),
        })),
      }
}

/** Where a menu asked for from the keyboard goes: under the entry's text. */
function entryPoint(rowElement: Element) {
  const rect = (rowElement.querySelector('.content') ?? rowElement).getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

function openMenuFromKey(row: TreeRow) {
  const element = rowElement(rowKey(row))
  if (element != null) openMenu(row, entryPoint(element), true)
}

/** Closes the menu; one the keyboard opened gives the focus back to its entry. */
function closeMenu() {
  const closing = menu.value
  menu.value = undefined
  if (closing?.keyboard) void focusRow(closing.row)
}

/** The popup is placed from the click point and the keyboard is not its own: close it on Escape. */
useEventListener(window, 'keydown', (event) => {
  if (event.key === 'Escape') closeMenu()
})

const scroller = computed(() => containerProps.ref.value)

function rowElement(key: string): HTMLElement | undefined {
  return Array.from(scroller.value?.querySelectorAll<HTMLElement>('[data-row-key]') ?? []).find(
    (element) => element.dataset.rowKey === key,
  )
}

/** Moves the focus to the row with this key, scrolling to it first if the list does not show it. */
async function focusRow(key: string) {
  activeKey.value = key
  if (rowElement(key) == null) {
    const index = tree.rows.value.findIndex((row) => rowKey(row) === key)
    if (index < 0) return
    scrollTo(index)
    await nextTick()
  }
  rowElement(key)?.focus()
}

function onFocusin(event: FocusEvent) {
  const key = (event.target as Element | null)?.closest<HTMLElement>('[data-row-key]')?.dataset
    .rowKey
  if (key != null) activeKey.value = key
}

function onKeydown(event: KeyboardEvent) {
  stopCopy(event)
  const target = event.target as Element | null
  const element = target?.closest<HTMLElement>('[data-row-key]')
  if (element == null) return
  if (event.key === 'Escape' && menu.value != null) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu()
    return
  }
  const row = tree.rows.value.find((candidate) => rowKey(candidate) === element.dataset.rowKey)
  if (row == null) return
  // A button inside the row (a chevron or "Show more" the pointer focused) does its own Enter.
  if (event.key === 'Enter' && target?.tagName === 'BUTTON') return
  const action = treeKeyAction(tree.rows.value, row, event)
  if (action == null) return
  event.preventDefault()
  event.stopPropagation()
  switch (action.type) {
    case 'focus':
      void focusRow(rowKey(action.row))
      break
    case 'toggle':
      tree.toggle(action.path)
      break
    case 'activate':
      activate(action.row, action.all)
      break
    case 'more':
      tree.showMore(action.path)
      break
    case 'retry':
      tree.retry(action.path)
      break
    case 'menu':
      openMenu(action.row, entryPoint(element), true)
      break
    case 'none':
      break
  }
}
</script>

<template>
  <div class="JSONVisualization" tabindex="-1" @wheel.stop.passive @keydown="onKeydown">
    <pre v-if="prepared == null" class="raw" v-text="JSON.stringify(data, null, 2)" />
    <div
      v-else
      v-bind="containerProps"
      class="scroller"
      role="tree"
      aria-label="Values"
      data-testid="tree-scroller"
      @scroll="menu = undefined"
      @focusin="onFocusin"
    >
      <div v-bind="wrapperProps">
        <TreeRowView
          v-for="{ data: row } in list"
          :key="rowKey(row)"
          :row="row"
          :tabStop="rowKey(row) === tabStopKey"
          :style="{ height: `${ROW_HEIGHT_PX}px` }"
          @toggle="tree.toggle(row.path)"
          @more="tree.showMore(row.path)"
          @retry="tree.retry(row.path)"
          @activate="activate(row, $event)"
          @menu="openMenu(row, { x: $event.clientX, y: $event.clientY }, false)"
          @menuKey="openMenuFromKey(row)"
        />
      </div>
    </div>
    <GridPopupMenu
      v-if="menu"
      :items="menu.items"
      :point="menu.point"
      :focusFirst="menu.keyboard"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.JSONVisualization {
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  user-select: text;
}

.scroller {
  height: 100%;
}

.raw {
  margin: 0;
  white-space: pre-wrap;
}
</style>
