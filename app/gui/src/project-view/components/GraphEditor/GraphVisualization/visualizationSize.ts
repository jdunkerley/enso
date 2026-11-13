/** @file The size a node's visualization is drawn at. */
import type { Opt } from '@/util/data/opt'
import { Vec2 } from '@/util/data/vec2'

/**
 * The minimum width must be at least the total width of:
 * - both of toolbars that are always visible (32px + 60px), and
 * - the 4px flex gap between the toolbars.
 */
export const MIN_WIDTH_PX = 200
export const MIN_CONTENT_HEIGHT_PX = 32
export const DEFAULT_CONTENT_HEIGHT_PX = 150

/**
 * The size of a visualization with the given saved `width` and `height`, under a node whose
 * widgets are `nodeWidth` wide. The graph store uses this to know a visualization's rectangle
 * before it is drawn, so the component must not size itself any other way.
 */
export function visualizationSize(
  width: Opt<number>,
  height: Opt<number>,
  nodeWidth: number,
): Vec2 {
  return new Vec2(
    Math.max(width ?? 0, nodeWidth, MIN_WIDTH_PX),
    Math.max(height ?? DEFAULT_CONTENT_HEIGHT_PX, MIN_CONTENT_HEIGHT_PX),
  )
}

/** A change made with a visualization's resize handles. `position` is set by the left handle. */
export interface VisualizationResize {
  width?: number
  height?: number
  position?: Vec2
}
