<script setup lang="ts">
import SvgIcon from '@/components/SvgIcon.vue'
import { PAGE_SIZE, type TreeRow } from '@/components/visualizations/JSONVisualization/lazyTree'
import { computed } from 'vue'

const { row } = defineProps<{ row: TreeRow }>()
const emit = defineEmits<{
  toggle: []
  more: []
  retry: []
  activate: [all: boolean]
}>()

/** Indentation per level, in pixels. */
const INDENT_PX = 16

const node = computed(() =>
  row.kind === 'root' ? row.node
  : row.kind === 'entry' ? row.entry
  : undefined,
)
const leafText = computed(() =>
  node.value?.kind === 'leaf' ? JSON.stringify(node.value.value) : undefined,
)
const label = computed(() => (node.value?.kind !== 'leaf' ? node.value?.label : undefined))
const leafClass = computed(() => {
  if (node.value?.kind !== 'leaf') return undefined
  const value = node.value.value
  if (value === null) return 'null'
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ?
      typeof value
    : 'other'
})
const title = computed(() => {
  if (row.kind !== 'entry') return leafText.value ?? ''
  const action =
    row.chain != null ?
      'Double-click to add a component for this entry; Shift+double-click adds one for each entry beside it.'
    : 'No expression reaches this entry, so double-clicking it adds nothing.'
  return leafText.value != null ? `${leafText.value}\n\n${action}` : action
})
const moreText = computed(() =>
  row.kind === 'more' ?
    `Show ${Math.min(PAGE_SIZE, row.total - row.shown)} more (of ${row.total.toLocaleString('en-US')})`
  : '',
)
</script>

<template>
  <div class="TreeRow" :class="row.kind" :style="{ paddingLeft: `${row.depth * INDENT_PX}px` }">
    <template v-if="row.kind === 'root' || row.kind === 'entry'">
      <button
        v-if="row.kind === 'entry' && row.entry.kind !== 'leaf'"
        class="arrow"
        :class="{ open: row.expanded }"
        :aria-label="row.expanded ? 'Collapse' : 'Expand'"
        :aria-expanded="row.expanded"
        @click.stop="emit('toggle')"
      >
        <SvgIcon name="chevron_right" />
      </button>
      <span v-else class="arrow" />
      <span class="content" :title="title" @dblclick.stop="emit('activate', $event.shiftKey)">
        <!-- Vue drops the whitespace between these spans (it holds a newline), so the text reads
             `key: value` exactly; the Playwright spec matches it. -->
        <span v-if="row.kind === 'entry'" class="key" v-text="String(row.entry.key)" />
        <span v-if="row.kind === 'entry'" class="sep" v-text="': '" />
        <span v-if="leafText != null" class="value" :class="leafClass" v-text="leafText" />
        <span v-else class="label" v-text="label" />
      </span>
    </template>
    <button
      v-else-if="row.kind === 'more'"
      class="more"
      @click.stop="emit('more')"
      v-text="moreText"
    />
    <span v-else-if="row.kind === 'loading'" class="loading">Loading…</span>
    <span v-else class="error">
      <span v-text="`couldn't load: ${row.message}`" />
      <button class="retry" @click.stop="emit('retry')">Retry</button>
    </span>
  </div>
</template>

<style scoped>
.TreeRow {
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  overflow: hidden;
  font-family: var(--font-mono);
}

.arrow {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: none;
  --icon-size: 12px;
}

button.arrow {
  cursor: pointer;
}

.arrow.open {
  --icon-transform: rotate(90deg);
}

.content {
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}

.key {
  color: blue;
}

.value {
  color: darkgreen;
}

.label,
.loading {
  color: #666;
}

.more,
.retry {
  padding: 0;
  border: none;
  background: none;
  color: blue;
  cursor: pointer;
  font: inherit;
}

.error {
  display: flex;
  gap: 8px;
  color: #b00020;
}
</style>
