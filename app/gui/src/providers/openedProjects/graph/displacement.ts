/** @file Lays the graph out around a node that changed size: the graph store's side of `nodeDisplacement`. */
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { visualizationSize } from '@/components/GraphEditor/GraphVisualization/visualizationSize'
import {
  boxAt,
  relayout,
  type Box,
  type Change,
  type Displaced,
  type LayoutNode,
} from '@/components/GraphEditor/nodeDisplacement'
import type { Opt } from '@/util/data/opt'
import { Vec2 } from '@/util/data/vec2'
import type { DeepReadonly, MutableModule, NodeDisplacementMetadata } from 'ydoc-shared/ast'
import type { VisualizationMetadata } from 'ydoc-shared/yjsModel'

/** A node as the layout sees it. */
export interface DisplacementNode {
  id: NodeId
  position: Vec2
  vis: Opt<VisualizationMetadata>
  /** Never moved: an input node. */
  fixed: boolean
}

/** What a change sets on a node. An absent key leaves that part as it is. */
export interface NodeChange {
  vis?: Opt<VisualizationMetadata>
  position?: Vec2
}

export interface DisplacementDeps {
  /** Every node of the current graph, as it is before the change being laid out. */
  nodes(): Iterable<DisplacementNode>
  /** The node's measured size without its visualization. */
  bareSize(id: NodeId): Vec2 | undefined
  /** The node's `displaced` metadata, read from `edit` when given. */
  readDisplaced(
    id: NodeId,
    edit?: MutableModule,
  ): DeepReadonly<NodeDisplacementMetadata> | undefined
  write(
    id: NodeId,
    placement: {
      position: Vec2
      displaced: NodeDisplacementMetadata | undefined
    },
    edit?: MutableModule,
  ): void
}

/**
 * A node's rectangle, computed, not measured: the measured rectangles lag the metadata by a frame
 * and include a previewed visualization. The visualization sits below the node's widgets and is at
 * least as wide as them.
 */
export function nodeBox(position: Vec2, bare: Vec2, vis: Opt<VisualizationMetadata>): Box {
  if (!vis?.visible) return boxAt(position, bare)
  const viz = visualizationSize(vis.width, vis.height, bare.x)
  return boxAt(position, { x: Math.max(bare.x, viz.x), y: bare.y + viz.y })
}

const NO_BOX: Box = { left: 0, top: 0, right: 0, bottom: 0 }

/** The layout of the graph around nodes that change. */
export function createDisplacement(deps: DisplacementDeps) {
  function layoutNodes(
    updates: ReadonlyMap<NodeId, NodeChange>,
    without: ReadonlySet<NodeId>,
    edit?: MutableModule,
  ): { nodes: LayoutNode[]; oldBoxes: Map<NodeId, Box> } {
    const nodes: LayoutNode[] = []
    const oldBoxes = new Map<NodeId, Box>()
    for (const node of deps.nodes()) {
      const bare = deps.bareSize(node.id)
      const measured = bare != null && bare.x > 0 && bare.y > 0
      if (measured) oldBoxes.set(node.id, nodeBox(node.position, bare, node.vis))
      if (without.has(node.id)) continue
      const update = updates.get(node.id)
      const position = update?.position ?? node.position
      const vis = update && 'vis' in update ? update.vis : node.vis
      const box = measured ? nodeBox(position, bare, vis) : undefined
      nodes.push({
        id: node.id,
        pos: { x: position.x, y: position.y },
        size: box ? { x: box.right - box.left, y: box.bottom - box.top } : { x: 0, y: 0 },
        // `relayout` copies what it changes and never mutates the field it is given.
        displaced: deps.readDisplaced(node.id, edit) as Displaced | undefined,
        fixed: node.fixed,
      })
    }
    return { nodes, oldBoxes }
  }

  function apply(nodes: LayoutNode[], changes: Change[], edit?: MutableModule) {
    for (const [id, placement] of relayout(nodes, changes)) {
      deps.write(
        id as NodeId,
        {
          position: new Vec2(placement.pos.x, placement.pos.y),
          displaced: placement.displaced as NodeDisplacementMetadata | undefined,
        },
        edit,
      )
    }
  }

  return {
    /**
     * Lay out around nodes that are about to change. Call this before writing the change. With
     * `adds` false the nodes were moved by hand: what they pushed is released and nothing new is
     * pushed.
     */
    afterChange(updates: ReadonlyMap<NodeId, NodeChange>, adds: boolean, edit?: MutableModule) {
      const { nodes, oldBoxes } = layoutNodes(updates, new Set(), edit)
      const changes = [...updates.keys()]
        .flatMap((id): Change[] => {
          const old = oldBoxes.get(id)
          return old ? [{ id, old, adds }] : []
        })
        // Top to bottom, so the result does not depend on the order of a selection.
        .sort((a, b) => a.old.top - b.old.top)
      apply(nodes, changes, edit)
    },
    /** Lay out after the user removed nodes: what they pushed returns. */
    afterRemoval(ids: Iterable<NodeId>, edit?: MutableModule) {
      const without = new Set(ids)
      const { nodes, oldBoxes } = layoutNodes(new Map(), without, edit)
      const changes = [...without].map((id): Change => ({
        id,
        old: oldBoxes.get(id) ?? NO_BOX,
        adds: false,
      }))
      apply(nodes, changes, edit)
    },
  }
}
