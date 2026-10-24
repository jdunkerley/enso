<script setup lang="ts">
/**
 * @file The Logs tab's rows: a virtualised list that follows the newest row until the user scrolls
 * up, and keeps its place when rows are added above or dropped from the top.
 */
import { useText } from '$/providers/text'
import { useResizeObserver } from '@/composables/events'
import type { TextId } from 'enso-common/src/text'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ERROR_LEVEL, WARN_LEVEL, type DividerKind, type LogRow } from './engineLogModel'
import { isNearBottom, ROW_HEIGHT_PX, visibleRange } from './engineLogView'

const { rows, canLoad = true } = defineProps<{
  rows: readonly LogRow[]
  /** Whether the dividers' load buttons are enabled (not while a load is running). */
  canLoad?: boolean
}>()
const follow = defineModel<boolean>('follow', { required: true })
const emit = defineEmits<{ reachedTop: []; loadOlder: []; loadNewer: [] }>()
const { getText } = useText()

const DIVIDER_TEXT: Readonly<Record<DividerKind, TextId>> = {
  restarted: 'engineLogsRestarted',
  skipped: 'engineLogsSkipped',
  truncated: 'engineLogsTruncated',
  newer: 'engineLogsNewer',
}

/** The dividers that offer to load the lines they stand for. */
const DIVIDER_LOAD: Readonly<Partial<Record<DividerKind, { text: TextId; load: () => void }>>> = {
  truncated: { text: 'engineLogsLoadOlder', load: () => emit('loadOlder') },
  newer: { text: 'engineLogsLoadNewer', load: () => emit('loadNewer') },
}

const scroller = ref<HTMLElement>()
const scrollerSize = useResizeObserver(scroller)
const scrollTop = ref(0)
const range = computed(() => visibleRange(scrollTop.value, scrollerSize.value.y, rows.length))
const visible = computed(() =>
  rows
    .slice(range.value.start, range.value.end)
    .map((row, offset) => ({ row, index: range.value.start + offset })),
)

function rowClass(row: LogRow) {
  return row.kind === 'divider' ?
      { divider: true }
    : {
        line: true,
        stderr: row.source === 'stderr',
        error: row.level === ERROR_LEVEL,
        warn: row.level === WARN_LEVEL,
        continuation: !row.entryStart,
      }
}

function scrollToEnd() {
  const element = scroller.value
  if (element == null) return
  element.scrollTop = element.scrollHeight
  scrollTop.value = element.scrollTop
}

function onScroll() {
  const element = scroller.value
  if (element == null) return
  scrollTop.value = element.scrollTop
  follow.value = isNearBottom(element)
  if (element.scrollTop <= 0 && rows.length > 0) emit('reachedTop')
}

/** A scroll up at the top: no `scroll` event fires when the rows do not fill the view. */
function onWheel(event: WheelEvent) {
  if (event.deltaY < 0 && (scroller.value?.scrollTop ?? 0) <= 0 && rows.length > 0) {
    emit('reachedTop')
  }
}

onMounted(() => {
  if (follow.value) scrollToEnd()
})

watch(
  () => rows,
  async (now, before) => {
    await nextTick()
    if (follow.value) {
      scrollToEnd()
      return
    }
    // Keep the row at the top of the view in place when rows are added above it or dropped.
    const element = scroller.value
    if (element == null || before.length === 0) return
    const topIndex = Math.floor(element.scrollTop / ROW_HEIGHT_PX)
    // Anchor on a line: a divider at the top (the one whose button loaded older lines) stays there.
    let anchorIndex = topIndex
    while (before[anchorIndex]?.kind === 'divider') anchorIndex += 1
    const anchor = before[anchorIndex]
    if (anchor == null) return
    const index = now.findIndex((row) => row.key === anchor.key)
    if (index >= 0 && index !== anchorIndex) {
      element.scrollTop += (index - anchorIndex) * ROW_HEIGHT_PX
      scrollTop.value = element.scrollTop
    }
  },
)

// The Logs tab stays mounted while hidden, with a zero-height scroller: when it shows again, the
// rows that arrived meanwhile are below the view, so follow them (the virtual range re-measures
// itself from `scrollerSize`).
watch(
  () => scrollerSize.value.y,
  (height, before) => {
    if (before === 0 && height > 0 && follow.value) void nextTick(scrollToEnd)
  },
)

watch(follow, (following) => {
  if (following) void nextTick(scrollToEnd)
})
</script>

<template>
  <div
    ref="scroller"
    class="EngineLogList"
    role="log"
    tabindex="0"
    :aria-label="getText('bottomDockLogsTab')"
    @scroll="onScroll"
    @wheel.stop.passive="onWheel"
  >
    <div class="content" :style="{ height: `${rows.length * ROW_HEIGHT_PX}px` }">
      <div
        v-for="{ row, index } in visible"
        :key="row.key"
        class="row"
        :class="rowClass(row)"
        :style="{ transform: `translateY(${index * ROW_HEIGHT_PX}px)` }"
        :title="row.kind === 'line' ? row.text : undefined"
      >
        <template v-if="row.kind === 'line'">
          <span v-if="row.source === 'stderr'" class="marker">stderr</span>
          <span class="text">{{ row.text }}</span>
        </template>
        <template v-else>
          <span class="dividerText">{{ getText(DIVIDER_TEXT[row.divider]) }}</span>
          <button
            v-if="DIVIDER_LOAD[row.divider] != null"
            type="button"
            class="load"
            :disabled="!canLoad"
            @click="DIVIDER_LOAD[row.divider]?.load()"
          >
            {{ getText(DIVIDER_LOAD[row.divider]!.text) }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.EngineLogList {
  position: relative;
  overflow: auto;
  /*noinspection CssNoGenericFontName*/
  font-family: var(--font-mono);
  font-variant-ligatures: var(--font-mono-readonly-variant-ligatures);
  font-feature-settings: var(--font-mono-readonly-feature-settings);
  font-size: 12px;
  outline: none;
}

/* The list is focusable (to scroll it with the keyboard): show where keyboard focus is. */
.EngineLogList:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.content {
  position: relative;
  width: 100%;
}

.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  line-height: 18px;
  padding: 0 8px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}

.row.warn {
  color: color-mix(in oklab, var(--color-warning) 60%, black);
}

.row.error {
  color: var(--color-error);
}

.row.continuation {
  opacity: 0.85;
}

.marker {
  display: inline-block;
  margin-right: 6px;
  padding: 0 4px;
  border-radius: 4px;
  line-height: 14px;
  font-size: 10px;
  background-color: var(--color-error);
  color: var(--color-text-inversed);
}

.row.divider {
  text-align: center;
  font-style: italic;
  color: color-mix(in oklab, var(--color-text) 60%, transparent);
  border-top: 1px dashed var(--color-dim);
}

.load {
  margin-left: 8px;
  padding: 0 6px;
  height: 16px;
  line-height: 14px;
  border-radius: 4px;
  border: 1px solid var(--color-dim);
  background-color: white;
  color: var(--color-text);
  font: inherit;
  font-style: normal;
  cursor: pointer;
}

.load:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
