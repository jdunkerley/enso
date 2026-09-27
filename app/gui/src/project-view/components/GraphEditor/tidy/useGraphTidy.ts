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

/**
 * Build the layout model for the components in `scope` (the whole graph when undefined).
 *
 * `pickInCodeOrder`, as exposed by the graph store, orders body statements by their line; it
 * doesn't cover function arguments, so those are ordered separately, by argument index, ahead of
 * the body. Every component's `order` field ends up reflecting this real code order, rather than
 * `db.nodeIdToNode`'s insertion order — which is stable only until a node added later happens to
 * sit on an earlier line, e.g. one inserted mid-function.
 */
export function buildTidyModel(
  db: GraphDb,
  scope: ReadonlySet<NodeId> | undefined,
  sizeOf: (id: NodeId) => Vec2 | undefined,
  defaultSize: Vec2,
  pickInCodeOrder: (ids: Set<NodeId>) => readonly NodeId[],
): LayoutComponent<NodeId>[] {
  const inScopeUnordered = [...db.nodeIdToNode.keys()].filter(
    (id) => scope == null || scope.has(id),
  )
  const isInput = (id: NodeId) => db.nodeIdToNode.get(id)!.type === 'input'
  const [inputIds, bodyIds] = [
    inScopeUnordered.filter(isInput),
    inScopeUnordered.filter((id) => !isInput(id)),
  ]
  inputIds.sort(
    (a, b) => (db.nodeIdToNode.get(a)!.argIndex ?? 0) - (db.nodeIdToNode.get(b)!.argIndex ?? 0),
  )
  const orderedBody = pickInCodeOrder(new Set(bodyIds))
  // Every body id is expected back, just reordered; if one isn't (the db and the executed method's
  // AST momentarily disagree on the function body), keep it rather than silently drop a component.
  const orderedBodySet = new Set(orderedBody)
  const missing = bodyIds.filter((id) => !orderedBodySet.has(id))
  const ids = [...inputIds, ...orderedBody, ...missing]
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
      graphStore.pickInCodeOrder,
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
