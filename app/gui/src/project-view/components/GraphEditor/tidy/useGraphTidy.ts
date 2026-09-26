/**
 * @file Tidy up: the adapter from the graph store to `streamLayout`. Builds the layout model from
 * the graph database and writes the resulting positions back as one undoable edit.
 */
import type { GraphStore, NodeId } from '$/providers/openedProjects/graph'
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module/module'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import theme from '@/util/theme'
import type { Ref } from 'vue'
import { streamLayout, type LayoutComponent } from './streamLayout'

/** Build the layout model for the components in `scope` (the whole graph when undefined). */
export function buildTidyModel(
  db: GraphDb,
  scope: ReadonlySet<NodeId> | undefined,
  sizeOf: (id: NodeId) => Vec2 | undefined,
  defaultSize: Vec2,
): LayoutComponent<NodeId>[] {
  const ids = [...db.nodeIdToNode.keys()].filter((id) => scope == null || scope.has(id))
  const inScope = new Set(ids)

  // Each input's position within its target's inner expression, for stable argument order.
  const argIndex = new Map<NodeId, Map<Ast.AstId, number>>()
  for (const id of ids) {
    const exprs = new Map<Ast.AstId, number>()
    Ast.visitRecursive(
      db.nodeIdToNode.get(id)!.innerExpr,
      (ast) => void exprs.set(ast.id, exprs.size),
    )
    argIndex.set(id, exprs)
  }

  const inputs = new Map<NodeId, { source: NodeId; argIndex: number }[]>(ids.map((id) => [id, []]))
  const selfSource = new Map<NodeId, NodeId>()
  for (const { targetExprId, targetNode, nodeWithSource } of db.iterateConnections()) {
    if (targetNode == null || nodeWithSource == null) continue
    if (!inScope.has(targetNode) || !inScope.has(nodeWithSource) || targetNode === nodeWithSource)
      continue
    const index = argIndex.get(targetNode)!.get(targetExprId) ?? Number.MAX_SAFE_INTEGER
    inputs.get(targetNode)!.push({ source: nodeWithSource, argIndex: index })
    if (db.nodeIdToNode.get(targetNode)!.primaryApplication.selfArgument === targetExprId)
      selfSource.set(targetNode, nodeWithSource)
  }

  return ids.map((id, order) => ({
    id,
    order,
    size: sizeOf(id) ?? defaultSize,
    position: db.nodeIdToNode.get(id)!.position,
    selfSource: selfSource.get(id),
    inputs: [
      ...new Set(
        inputs
          .get(id)!
          .sort((a, b) => a.argIndex - b.argIndex)
          .map((i) => i.source),
      ),
    ],
  }))
}

/** Tidy up: lay out the whole graph, or the given selection, and write positions as one undoable edit. */
export function useGraphTidy(graphStore: GraphStore, module: Ref<ModuleStore>) {
  const defaultSize = new Vec2(theme.node.height * 4, theme.node.height)
  function tidy(selection?: readonly NodeId[]) {
    const scope = selection != null && selection.length > 1 ? new Set(selection) : undefined
    const model = buildTidyModel(
      graphStore.db,
      scope,
      (id) => graphStore.visibleArea(id)?.size,
      defaultSize,
    ).filter((c) => Number.isFinite(c.position.x) && Number.isFinite(c.position.y))
    if (model.length < 2) return
    const positions = streamLayout(model, {
      horizontal: theme.node.horizontal_gap,
      vertical: theme.node.vertical_gap,
    })
    module.value.batchEdits(() => {
      for (const [id, position] of positions) graphStore.setNodePosition(id, position)
    })
  }
  return { tidy }
}
