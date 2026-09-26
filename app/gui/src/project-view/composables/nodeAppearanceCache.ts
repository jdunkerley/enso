import type { GraphStore, NodeId } from '$/providers/openedProjects/graph'
import type { NodeType } from '$/providers/openedProjects/graph/graphDatabase'
import type { NodeColorSource } from '@/composables/nodeColors'
import { DEFAULT_ICON, iconOfNode } from '@/util/getIconName'
import { computed, watch } from 'vue'
import type { CachedAppearance } from 'ydoc-shared/ast'

/** What {@link appearanceToCache} needs to know about a node. */
export interface AppearanceInput {
  type: NodeType
  /** Whether the node is waiting for its value (`Unknown` or `Pending` payload). */
  pending: boolean
  hasColorOverride: boolean
  colorSource: NodeColorSource
  /** The displayed colour with any `var(--…)` resolved; `undefined` if it could not be resolved. */
  resolvedColor: string | undefined
  /** The icon computed from current data alone, ignoring the cache. */
  icon: string
  stored: CachedAppearance | undefined
}

/**
 * The appearance to save for a node, or `undefined` if nothing should be written: the node is not
 * a computed component, its colour is not known from current data, or nothing has changed.
 */
export function appearanceToCache(input: AppearanceInput): CachedAppearance | undefined {
  if (input.type !== 'component' || input.pending) return undefined
  let color: string | undefined
  if (input.hasColorOverride) {
    // The override is saved separately and always wins; keep whatever colour was cached before.
    color = input.stored?.color
  } else {
    if (input.colorSource !== 'group' && input.colorSource !== 'type') return undefined
    color = input.resolvedColor?.trim()
    if (!color) return undefined
  }
  const icon = input.icon === DEFAULT_ICON ? undefined : input.icon
  if (input.stored?.color === color && input.stored?.icon === icon) return undefined
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  }
}

/**
 * Keep each node's `cachedAppearance` metadata in step with its computed colour and icon, so that
 * the next time the project is opened, nodes can be shown in their colours before they are
 * recomputed. Changes seen together are written in one batch, off the undo stack.
 *
 * `ready` must stay false until library groups are loaded; otherwise a group-coloured node would
 * be cached with its type colour first and rewritten moments later.
 */
export function useNodeAppearanceCache(
  graph: GraphStore,
  getNodeColor: (id: NodeId) => string | undefined,
  ready: () => boolean,
) {
  const writes = computed(() => {
    const result = new Map<NodeId, CachedAppearance>()
    if (!ready()) return result
    const db = graph.db
    for (const [id, node] of db.nodeIdToNode.entries()) {
      if (node.type !== 'component') continue
      const payload = db.getExpressionInfo(node.innerExpr.externalId)?.payload.type ?? 'Unknown'
      const pending = payload === 'Unknown' || payload === 'Pending'
      if (pending) continue
      const colorSource = db.getNodeColorSource(id)
      const update = appearanceToCache({
        type: node.type,
        pending,
        hasColorOverride: node.colorOverride != null,
        colorSource,
        resolvedColor:
          colorSource === 'group' || colorSource === 'type' ? getNodeColor(id) : undefined,
        icon: iconOfNode(id, db, { useCachedIcon: false }),
        stored: node.cachedAppearance,
      })
      if (update) result.set(id, update)
    }
    return result
  })
  watch(
    writes,
    (appearances) => {
      if (appearances.size > 0) graph.setNodeCachedAppearances(appearances)
    },
    { flush: 'post' },
  )
}
