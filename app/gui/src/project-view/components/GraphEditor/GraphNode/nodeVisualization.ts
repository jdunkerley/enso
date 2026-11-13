import type { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import type { ToValue } from '$/utils/reactivity'
import type GraphVisualization from '@/components/GraphEditor/GraphVisualization.vue'
import type { RawDataSource } from '@/components/GraphEditor/GraphVisualization/visualizationData'
import type { VisualizationResize } from '@/components/GraphEditor/GraphVisualization/visualizationSize'
import { injectBubblingKeyboard } from '@/providers/keyboard'
import type { VisualizationDataSource } from '@/stores/visualization'
import type { Opt } from '@/util/data/opt'
import { Vec2 } from '@/util/data/vec2'
import { computed, ref, toValue, watch } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'
import type { VisualizationIdentifier, VisualizationMetadata } from 'ydoc-shared/yjsModel'

interface Emit {
  (event: 'update:visualizationEnabled', enabled: boolean): void
  (event: 'update:visualizationId', id: Opt<VisualizationIdentifier>): void
  (event: 'update:visualizationEnabled', enabled: boolean): void
  (event: 'resizeVisualization', change: VisualizationResize): void
}

interface NodeVisualizationOptions {
  vis: ToValue<Opt<VisualizationMetadata>>
  nodeHovered: ToValue<boolean>
  nodeWidgetsSize: ToValue<Vec2>
  nodePos: ToValue<Vec2>
  scale: ToValue<number>
  isFocused: ToValue<boolean>
  typeinfo: ToValue<Opt<TypeInfo>>
  dataSource: ToValue<Opt<VisualizationDataSource | RawDataSource>>
  hidden: ToValue<boolean>
  emit: Emit
  /** A handle drag on the visualization started or ended. */
  onResizingChange?: (resizing: boolean) => void
}

/** Composable managing the state of the visualization for a node. */
export function useNodeVisualization({
  vis,
  nodeHovered,
  nodeWidgetsSize,
  nodePos,
  scale,
  isFocused,
  typeinfo,
  dataSource,
  hidden,
  emit,
  onResizingChange,
}: NodeVisualizationOptions) {
  const keyboard = injectBubblingKeyboard()
  const metadata = computed(() => toValue(vis))
  const visualizationWidth = computed<number | null>(() => metadata.value?.width ?? null)
  const visualizationHeight = computed<number | null>(() => metadata.value?.height ?? null)
  const isVisualizationEnabled = computed<boolean>({
    get: () => metadata.value?.visible ?? false,
    set: (value) => emit('update:visualizationEnabled', value),
  })

  function hoverWithLease(baseHover: ToValue<boolean>) {
    const hoverWithLease = ref(toValue(baseHover))
    watch(
      () => toValue(baseHover),
      (immediateHovered) => {
        if (immediateHovered) hoverWithLease.value = true
        else {
          requestAnimationFrame(() => {
            hoverWithLease.value = toValue(baseHover)
          })
        }
      },
      { flush: 'post' },
    )
    return hoverWithLease
  }

  const visualizationHovered = ref(false)
  const visHoveredWithLease = hoverWithLease(visualizationHovered)
  const nodeHoveredWithLease = hoverWithLease(nodeHovered)

  const isVisualizationPreviewed = computed(
    () =>
      !isVisualizationEnabled.value &&
      keyboard.mod &&
      (visHoveredWithLease.value || nodeHoveredWithLease.value),
  )

  const isVisualizationVisible = computed(
    () => isVisualizationEnabled.value || isVisualizationPreviewed.value,
  )

  watch(isVisualizationVisible, (visible) => {
    if (!visible && visualizationHovered.value) visualizationHovered.value = false
  })

  const effectiveHeight = ref<number>()
  const visibleVisHeight = computed((): number => {
    if (!isVisualizationVisible.value || toValue(hidden)) return 0
    return effectiveHeight.value ?? 0
  })
  const effectiveWidth = ref<number>()
  const visibleVisWidth = computed((): number => {
    if (!isVisualizationVisible.value || toValue(hidden)) return 0
    return effectiveWidth.value ?? 0
  })
  const visualization = computed((): ComponentProps<typeof GraphVisualization> => {
    return {
      show: isVisualizationVisible.value,
      width: visualizationWidth.value,
      nodeSize: toValue(nodeWidgetsSize),
      scale: toValue(scale),
      nodePosition: toValue(nodePos),
      currentType: metadata.value?.identifier,
      dataSource: toValue(dataSource) ?? undefined,
      typeinfo: toValue(typeinfo) ?? undefined,
      height: visualizationHeight.value,
      isFocused: toValue(isFocused),
      isPreview: isVisualizationPreviewed.value,
      isFullscreenAllowed: true,
      isResizable: true,
      'onUpdate:hovered': (event) => (visualizationHovered.value = event),
      'onUpdate:effectiveHeight': (event) => (effectiveHeight.value = event),
      'onUpdate:effectiveWidth': (event) => (effectiveWidth.value = event),
      'onUpdate:id': (event) => emit('update:visualizationId', event),
      'onUpdate:enabled': (event) => emit('update:visualizationEnabled', event),
      onResize: (event) => emit('resizeVisualization', event),
      'onUpdate:resizing': (event) => onResizingChange?.(event),
    }
  })

  return {
    visualizationWidth: visibleVisWidth,
    isVisualizationEnabled,
    isVisualizationPreviewed,
    vizHeight: visibleVisHeight,
    visualization,
  }
}
