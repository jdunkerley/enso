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
import { parseVizActions, plainActionToolbar } from '@/components/visualizations/vizActions'
import { stopCopy } from '@/util/shortcuts'
import { useVisualizationConfig } from '@/util/visualizationBuiltins'
import { useVirtualList } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

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
watch(prepared, (value) => tree.setRoot(value), { immediate: true })

const { list, containerProps, wrapperProps } = useVirtualList(tree.rows, {
  itemHeight: ROW_HEIGHT_PX,
  overscan: 10,
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

/** The open right-click menu, where it was asked for. */
const menu = shallowRef<{ point: { x: number; y: number }; items: GridMenuItem[] }>()

function openMenu(row: TreeRow, event: MouseEvent) {
  const entries = entryMenu(tree.rows.value, row)
  menu.value =
    entries.length === 0 ?
      undefined
    : {
        point: { x: event.clientX, y: event.clientY },
        items: entries.map(({ name, icon, chains }) => ({
          type: 'item',
          name,
          icon: menuIconHtml(icon),
          action: () => createNodesFor(chains),
        })),
      }
}

function rowKey(row: TreeRow) {
  return `${row.kind}:${JSON.stringify(row.path)}`
}
</script>

<template>
  <div class="JSONVisualization" tabindex="-1" @wheel.stop.passive @keydown="stopCopy">
    <pre v-if="prepared == null" class="raw" v-text="JSON.stringify(data, null, 2)" />
    <div v-else v-bind="containerProps" class="scroller" data-testid="tree-scroller">
      <div v-bind="wrapperProps">
        <TreeRowView
          v-for="{ data: row } in list"
          :key="rowKey(row)"
          :row="row"
          :style="{ height: `${ROW_HEIGHT_PX}px` }"
          @toggle="tree.toggle(row.path)"
          @more="tree.showMore(row.path)"
          @retry="tree.retry(row.path)"
          @activate="activate(row, $event)"
          @menu="openMenu(row, $event)"
        />
      </div>
    </div>
    <GridPopupMenu v-if="menu" :items="menu.items" :point="menu.point" @close="menu = undefined" />
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
