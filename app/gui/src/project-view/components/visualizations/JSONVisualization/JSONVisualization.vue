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
  pathKey,
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
    tree.setRoot(value)
    // The menu holds chains made for the old payload. Closed after the tree has the new rows, so
    // the focus it held goes to the entry if the new payload has it, and to the first row if not.
    closeMenu()
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

/**
 * Closes the menu. One the keyboard opened gives the focus back to its entry (the first row if a
 * new payload has no such entry), unless the pointer closed it: a click outside then keeps the
 * focus it moves itself.
 */
function closeMenu(reason?: 'pointer') {
  const closing = menu.value
  menu.value = undefined
  if (closing == null || !closing.keyboard || reason === 'pointer') return
  const rows = tree.rows.value
  const target = rows.find((row) => rowKey(row) === closing.row) ?? rows.find(isNavigable)
  if (target != null) void focusRow(rowKey(target))
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

/**
 * The focused element in the tree's own DOM root. A visualization lives in a shadow root, where
 * `document.activeElement` is only the host.
 */
function focusedElement(): Element | null {
  const root = scroller.value?.getRootNode()
  return root instanceof ShadowRoot || root instanceof Document ?
      root.activeElement
    : document.activeElement
}

/**
 * Loads more of a branch (`Show more`) or loads a failed page again (`Retry`) from `row`. The row
 * gives way to a "Loading…" row, which cannot hold the focus, so the focus the row had goes to the
 * entry above while the page comes, then to the first entry it brings (or to the row, if it failed
 * again). A focus that has moved elsewhere meanwhile is left where it is.
 */
async function loadFrom(row: TreeRow, load: () => Promise<void>) {
  const key = rowKey(row)
  const hadFocus = rowElement(key)?.contains(focusedElement()) === true
  // By key: the list the template iterates may hand over a copy of the row, not the one in `rows`.
  const index = tree.rows.value.findIndex((candidate) => rowKey(candidate) === key)
  const above = tree.rows.value.slice(0, Math.max(index, 0)).reverse().find(isNavigable)
  const loaded = load()
  if (!hadFocus || above == null) return await loaded
  const aboveKey = rowKey(above)
  await focusRow(aboveKey)
  await loaded
  await nextTick()
  const active = focusedElement()
  if (active != null && active !== document.body && active !== rowElement(aboveKey)) return
  const rows = tree.rows.value
  const first = rows[index]
  const brought =
    (
      first?.kind === 'entry' &&
      first.path.length === row.path.length + 1 &&
      pathKey(first.path.slice(0, -1)) === pathKey(row.path)
    ) ?
      first
    : rows.find((candidate) => rowKey(candidate) === key)
  if (brought != null) await focusRow(rowKey(brought))
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
      void loadFrom(row, () => tree.showMore(action.path))
      break
    case 'retry':
      void loadFrom(row, () => tree.retry(action.path))
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
      @scroll="closeMenu()"
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
          @more="loadFrom(row, () => tree.showMore(row.path))"
          @retry="loadFrom(row, () => tree.retry(row.path))"
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
      @close="closeMenu($event)"
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
