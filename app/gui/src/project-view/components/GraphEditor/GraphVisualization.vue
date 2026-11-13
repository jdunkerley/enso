<script setup lang="ts">
import { proxyRefs } from '$/utils/reactivity'
import { visualizationBindings } from '@/bindings'
import type { RawDataSource } from '@/components/GraphEditor/GraphVisualization/visualizationData'
import { useVisualizationData } from '@/components/GraphEditor/GraphVisualization/visualizationData'
import {
  visualizationSize,
  type VisualizationResize,
} from '@/components/GraphEditor/GraphVisualization/visualizationSize'
import VisualizationToolbar from '@/components/GraphEditor/GraphVisualization/VisualizationToolbar.vue'
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import { useResizeHandles } from '@/components/resizeHandles'
import ResizeHandles from '@/components/ResizeHandles.vue'
import WithFullscreenMode from '@/components/WithFullscreenMode.vue'
import { focusIsIn, useEvent, useResizeObserver } from '@/composables/events'
import { registerHandlers } from '@/providers/action'
import type { VisualizationDataSource } from '@/stores/visualization'
import type { Opt } from '@/util/data/opt'
import { Vec2 } from '@/util/data/vec2'
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { visIdentifierEquals, type VisualizationIdentifier } from 'ydoc-shared/yjsModel'

const props = defineProps<{
  show: boolean
  currentType?: Opt<VisualizationIdentifier>
  isFullscreenAllowed: boolean
  isResizable: boolean
  isPreview?: boolean
  nodePosition: Vec2
  nodeSize: Vec2
  width: Opt<number>
  height: Opt<number>
  scale: number
  isFocused: boolean
  typeinfo?: TypeInfo | undefined
  dataSource: VisualizationDataSource | RawDataSource | undefined
}>()
// # Effective sizes:
//
// The visualization has two types of dimensions:
// - The `width`/`height` props are the configured dimensions. They are only set by user action, and they are persisted.
// - The `effectiveWidth`/`effectiveHeight` values report the dimensions at which the visualization is rendered. They
//   may differ from the configured dimensions, e.g., if the node's widget-based size has become larger than the
//   configured size.
const emit = defineEmits<{
  'update:effectiveWidth': [width: number]
  'update:effectiveHeight': [height: number]
  'update:id': [id: VisualizationIdentifier]
  'update:enabled': [visible: boolean]
  /** A step of a handle drag. The left handle changes the width and the position together. */
  resize: [change: VisualizationResize]
  'update:hovered': [hovered: boolean]
  'update:resizing': [resizing: boolean]
  createNodes: [options: NodeCreationOptions[]]
}>()

// ===================================
// === Visualization-Specific Data ===
// ===================================

const {
  effectiveVisualization,
  effectiveVisualizationData,
  updatePreprocessor,
  allVisualizations,
  currentVisualization,
  setToolbarDefinition,
  visualizationDefinedToolbar,
  toolbarOverlay,
  executeExpression,
} = useVisualizationData({
  selectedVis: toRef(props, 'currentType'),
  dataSource: toRef(props, 'dataSource'),
  typeinfo: toRef(props, 'typeinfo'),
})

// ===========
// === DOM ===
// ===========

/** Includes content and toolbars. */
const panelElement = ref<HTMLElement>()

/** Contains only the visualization itself. */
const contentElement = ref<HTMLElement>()
const contentElementSize = useResizeObserver(contentElement)

// === Events ===

const isFullscreen = ref(false)

const actionHandlers = registerHandlers({
  'visualization.exitFullscreen': {
    action: () => (isFullscreen.value = false),
  },
  'component.toggleVisualization': {
    available: () => !isFullscreen.value,
    action: () => emit('update:enabled', false),
  },
  'visualization.nextType': {
    action: () => {
      const currentIndex = allVisualizations.value.findIndex((type) =>
        visIdentifierEquals(type, currentVisualization.value),
      )
      const nextIndex = (currentIndex + 1) % allVisualizations.value.length
      emit('update:id', allVisualizations.value[nextIndex]!)
    },
  },
})

const keydownHandler = visualizationBindings.handler({
  'visualization.nextType': () => {
    if (props.isFocused || focusIsIn(panelElement.value)) {
      actionHandlers['visualization.nextType'].action()
    } else {
      return false
    }
  },
  'panel.fullscreen': () => {
    if (props.isFocused || focusIsIn(panelElement.value)) {
      isFullscreen.value = !isFullscreen.value
    } else {
      return false
    }
  },
  'visualization.exitFullscreen': () => {
    if (isFullscreen.value) {
      actionHandlers['visualization.exitFullscreen'].action()
    } else {
      return false
    }
  },
})

// TODO[ao]: we use `globalEventRegistryPre` to make sure it takes precedence before GraphEditor handlers
//  (deselectAllNodes in particular). But this is quick workaround, the proper solution
//  should be soon delivered as part of https://github.com/enso-org/enso/issues/13695
const { globalEventRegistryPre } = useGlobalEventRegistry()
useEvent(globalEventRegistryPre, 'keydown', keydownHandler)

// =============================
// === Sizing and Fullscreen ===
// =============================

const vizSize = computed<Vec2>(() => visualizationSize(props.width, props.height, props.nodeSize.x))
const vizWidth = computed<number>(() => vizSize.value.x)
const vizHeight = computed<number>(() => vizSize.value.y)

watch(vizWidth, (width) => emit('update:effectiveWidth', width), { immediate: true })
watch(vizHeight, (height) => emit('update:effectiveHeight', height), { immediate: true })

const resizeHandles = useResizeHandles({
  size: vizSize,
  position: toRef(props, 'nodePosition'),
  scale: toRef(props, 'scale'),
})
// A side dragged onto the opposite one clamps the size to 0, which is not a size to save.
resizeHandles.onBoundsChange((bounds, sides) =>
  emit('resize', {
    ...((sides.left || sides.right) && bounds.width > 0 ? { width: bounds.width } : {}),
    ...((sides.top || sides.bottom) && bounds.height > 0 ? { height: bounds.height } : {}),
    ...(sides.left || sides.top ? { position: bounds.pos } : {}),
  }),
)

const handlesShown = computed(() => props.show && !props.isPreview && props.isResizable)
const handlesResizing = ref(false)
resizeHandles.onResizingChange(
  (resizing) =>
    (handlesResizing.value =
      !!resizing.top || !!resizing.bottom || !!resizing.left || !!resizing.right),
)
// Handles removed mid-drag report its end as they unmount, but that report may not arrive: a drag
// cannot outlive its handles either way.
watch(handlesShown, (shown) => {
  if (!shown) handlesResizing.value = false
})

// Only a handle drag counts: the graph makes room for a visualization that opens when its
// metadata is written, not when it is drawn.
watch(handlesResizing, (resizing) => emit('update:resizing', resizing))

const style = computed(() => {
  return {
    'padding-top': `${props.nodeSize.y}px`,
    width: `${vizSize.value.x}px`,
    height: `${vizSize.value.y + props.nodeSize.y}px`,
  }
})

const fullscreenAnimating = ref(false)

watch(
  () => isFullscreen,
  (f) => f && nextTick(() => panelElement.value?.focus()),
)

const nodeType = computed(() => props.typeinfo?.primaryType ?? undefined)
// Use proxy object instead of computed to keep granular reactive updates across the `params` prop fields.
const visParams: VisualizationHostParams = proxyRefs({
  visualization: effectiveVisualization,
  data: effectiveVisualizationData,
  size: contentElementSize,
  nodeType,
  executeExpression,
})
</script>

<script lang="ts">
import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import VisualizationHost, {
  type VisualizationHostParams,
} from '@/components/visualizations/VisualizationHost.vue'
import { useGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { defineCustomElement } from 'vue'

// ==========================
// === Visualization Host ===
// ==========================

let definitionNumber = 0
if (import.meta.hot) {
  import.meta.hot.data.graphVizDefinitionNumber =
    (import.meta.hot.data.graphVizDefinitionNumber ?? 0) + 1
  definitionNumber = import.meta.hot.data.graphVizDefinitionNumber
}
const ensoVisualizationHost = `enso-visualization-host-${definitionNumber}`
customElements.define(ensoVisualizationHost, defineCustomElement(VisualizationHost))
</script>

<template>
  <div
    v-if="props.show"
    class="GraphVisualization"
    :style="style"
    :class="{ isFocused }"
    @pointerenter="emit('update:hovered', true)"
    @pointerleave="emit('update:hovered', false)"
  >
    <WithFullscreenMode
      v-model="isFullscreen"
      :enabled="isFullscreenAllowed"
      @update:animating="fullscreenAnimating = $event"
    >
      <div
        ref="panelElement"
        class="VisualizationPanel"
        :class="{
          nonInteractive: isPreview,
        }"
        tabindex="-1"
      >
        <VisualizationToolbar
          :currentVis="currentVisualization"
          :showControls="!isPreview"
          :isFocused="isFocused"
          :allVisualizations="allVisualizations"
          :visualizationDefinedToolbar="visualizationDefinedToolbar"
          :typeinfo="typeinfo"
          :class="{ overlay: toolbarOverlay }"
          @update:currentVis="emit('update:id', $event)"
        />
        <div ref="contentElement" class="VisualizationHostContainer content scrollable">
          <component
            :is="ensoVisualizationHost"
            :params="visParams"
            @updatePreprocessor="
              updatePreprocessor($event.detail[0], $event.detail[1], ...$event.detail.slice(2))
            "
            @updateToolbar="setToolbarDefinition($event.detail[0])"
            @updateToolbarOverlay="toolbarOverlay = $event.detail[0]"
            @createNodes="emit('createNodes', $event.detail[0])"
          />
        </div>
      </div>
    </WithFullscreenMode>
    <ResizeHandles v-if="handlesShown" left right bottom v-on="resizeHandles.events" />
  </div>
</template>

<style scoped>
.GraphVisualization {
  --resize-handle-inside: var(--visualization-resize-handle-inside);
  --resize-handle-outside: var(--visualization-resize-handle-outside);
  --resize-handle-radius: var(--radius-default);
  position: absolute;
  border-radius: var(--radius-default);
  opacity: 0.9;
  overflow: hidden;
  transition: opacity 0.2s;
  &.isFocused {
    opacity: 1;
  }
}

.VisualizationPanel {
  --permanent-toolbar-width: 240px;
  color: var(--color-text);
  cursor: default;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-visualization-bg);
}

.content {
  overflow: auto;
  contain: strict;
  isolation: isolate;
  border-radius: 0 0 var(--radius-default) var(--radius-default);
  height: 100%;
  overscroll-behavior: contain;
}

.nonInteractive {
  pointer-events: none;
}

.overlay {
  position: absolute;
  z-index: 1;
}
</style>
