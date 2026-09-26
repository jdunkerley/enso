import type { GraphStore, NodeId } from '$/providers/openedProjects/graph'
import type { NodeType } from '$/providers/openedProjects/graph/graphDatabase'
import type { NodeColorSource } from '@/composables/nodeColors'
import { sanitizeCachedAppearance } from '@/util/cachedAppearance'
import { DEFAULT_ICON, iconOfNode } from '@/util/getIconName'
import { computed, watch } from 'vue'
import type { CachedAppearance } from 'ydoc-shared/ast'

/** What {@link appearanceToCache} needs to know about a node. */
export interface AppearanceInput {
  type: NodeType
  /** Whether the node is waiting for its value (`Unknown` or `Pending` payload). */
  pending: boolean
  /**
   * Whether the node's suggestion entry may just not be known yet
   * (`GraphDb.isNodeSuggestionPending`): its colour and icon are then derived from its type alone,
   * and would be rewritten once the entry arrives.
   */
  suggestionPending: boolean
  hasColorOverride: boolean
  colorSource: NodeColorSource
  /** The displayed colour with any `var(--…)` resolved; `undefined` if it could not be resolved. */
  resolvedColor: string | undefined
  /** The icon computed from current data alone, ignoring the cache. */
  icon: string
  stored: CachedAppearance | undefined
}

/**
 * The appearance this client computes for a node, or `undefined` if it has none to save: the node
 * is not a computed component, or its colour is not known from current data. Whether to write it
 * is decided by {@link appearanceToWrite}.
 */
export function appearanceToCache(input: AppearanceInput): CachedAppearance | undefined {
  if (input.type !== 'component' || input.pending || input.suggestionPending) return undefined
  let color: string | undefined
  if (input.hasColorOverride) {
    // The override is saved separately and always wins; keep whatever colour was cached before.
    color = input.stored?.color
  } else {
    if (input.colorSource !== 'group' && input.colorSource !== 'type') return undefined
    color = input.resolvedColor?.trim()
    // Only store what the reader (`sanitizeCachedAppearance`) will accept back — otherwise a
    // colour it rejects would be sanitized away on read and recomputed as still-different on
    // every reactive pass, writing forever.
    if (!color || sanitizeCachedAppearance({ color })?.color !== color) return undefined
  }
  const icon = input.icon === DEFAULT_ICON ? undefined : input.icon
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  }
}

function sameAppearance(a: CachedAppearance | undefined, b: CachedAppearance | undefined) {
  return a?.color === b?.color && a?.icon === b?.icon
}

/**
 * Whether to write `computed`, the appearance this client has just computed for a node: returns it
 * if so, `undefined` if not. `lastComputed` is what this client computed for the node before
 * (`undefined` on its first computation), `stored` what the metadata holds now.
 *
 * It is written only if it differs from `stored` and is either this client's first computation or
 * a change from its last one. A change in `stored` alone never causes a write: clients may
 * legitimately compute different appearances (execution mode, library versions, colour formats),
 * and if each rewrote the other's value they would do so forever. The last writer wins instead.
 */
export function appearanceToWrite(
  computed: CachedAppearance,
  lastComputed: CachedAppearance | undefined,
  stored: CachedAppearance | undefined,
): CachedAppearance | undefined {
  if (sameAppearance(computed, stored)) return undefined
  if (lastComputed != null && sameAppearance(computed, lastComputed)) return undefined
  return computed
}

interface ComputedAppearance {
  id: NodeId
  computed: CachedAppearance
  stored: CachedAppearance | undefined
}

/**
 * Keep each node's `cachedAppearance` metadata in step with its computed colour and icon, so that
 * the next time the project is opened, nodes can be shown in their colours before they are
 * recomputed. Changes seen together are written in one batch, off the undo stack.
 *
 * `ready` must stay false until the suggestion database is loaded; otherwise a group-coloured node
 * would be cached with its type colour first and rewritten moments later.
 */
export function useNodeAppearanceCache(
  graph: GraphStore,
  getNodeColor: (id: NodeId) => string | undefined,
  ready: () => boolean,
) {
  /** What this client last computed for each node; see {@link appearanceToWrite}. */
  const lastComputed = new Map<NodeId, CachedAppearance>()
  const appearances = computed(() => {
    const result: ComputedAppearance[] = []
    if (!ready()) return result
    const db = graph.db
    for (const [id, node] of db.nodeIdToNode.entries()) {
      if (node.type !== 'component') continue
      const payload = db.getExpressionInfo(node.innerExpr.externalId)?.payload.type ?? 'Unknown'
      const pending = payload === 'Unknown' || payload === 'Pending'
      if (pending) continue
      const colorSource = db.getNodeColorSource(id)
      const appearance = appearanceToCache({
        type: node.type,
        pending,
        suggestionPending: db.isNodeSuggestionPending(id),
        hasColorOverride: node.colorOverride != null,
        colorSource,
        resolvedColor:
          colorSource === 'group' || colorSource === 'type' ? getNodeColor(id) : undefined,
        icon: iconOfNode(id, db, { useCachedIcon: false }),
        stored: node.cachedAppearance,
      })
      if (appearance) result.push({ id, computed: appearance, stored: node.cachedAppearance })
    }
    return result
  })
  watch(
    appearances,
    (appearances) => {
      for (const id of lastComputed.keys()) {
        if (!graph.db.nodeIdToNode.has(id)) lastComputed.delete(id)
      }
      const writes = new Map<NodeId, CachedAppearance>()
      for (const { id, computed, stored } of appearances) {
        const write = appearanceToWrite(computed, lastComputed.get(id), stored)
        lastComputed.set(id, computed)
        if (write) writes.set(id, write)
      }
      if (writes.size > 0) graph.setNodeCachedAppearances(writes)
    },
    { flush: 'post' },
  )
}
