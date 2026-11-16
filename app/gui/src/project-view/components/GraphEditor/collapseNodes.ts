/**
 * @file Collapsing nodes into a new function, called by a single node that replaces them: the
 * graph editor's "Group components" action and the `collapse_nodes` MCP tool.
 */
import type { GraphStore } from '$/providers/openedProjects/graph'
import { asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module'
import { bail } from '@/util/assert'
import type { Identifier } from '@/util/ast/abstract'
import type { Rect } from '@/util/data/rect'
import type { Vec2 } from '@/util/data/vec2'
import * as iter from 'enso-common/src/utilities/data/iter'
import { Err, Ok, unwrapOr, type Result } from 'enso-common/src/utilities/data/result'
import { performCollapse, prepareCollapsedInfo } from './collapsing'

export interface CollapseDeps {
  readonly module: Pick<ModuleStore, 'edit' | 'root'>
  readonly graphStore: Pick<GraphStore, 'db' | 'currentMethod' | 'visibleArea' | 'releasePushedBy'>
  /** Where the call node goes, given the areas of the nodes collapsed. */
  readonly placeCollapsedNode: (collapsedNodeRects: Iterable<Rect>) => Vec2
  /** Where the output node of the new function goes, given the areas of the nodes moved into it. */
  readonly placeOutputNode: (movedNodeRects: Rect[]) => Vec2
}

export interface CollapseOutcome {
  /** The name of the new function. */
  readonly name: Identifier
  /** The node that calls the new function, in place of the collapsed ones. */
  readonly callNode: NodeId | undefined
}

/**
 * Moves the component nodes `nodeIds` into a new top-level function, inserted before the current
 * method, and puts a node calling it in their place, in one module edit. The function is named
 * `options.name` (a default name without it), with a number added when the name is taken.
 *
 * Err (and nothing changes) when there is no component node to collapse, or when the nodes cannot
 * be collapsed into one function (more than one of them is used outside); the error's payload says
 * why. Throws on a state that should not happen (no current method, no module).
 */
export function collapseNodes(
  deps: CollapseDeps,
  nodeIds: Iterable<NodeId>,
  options: { name?: Identifier } = {},
): Result<CollapseOutcome> {
  const { module, graphStore } = deps
  const selected = new Set(
    iter.filter(nodeIds, (id) => graphStore.db.nodeIdToNode.get(id)?.type === 'component'),
  )
  if (selected.size == 0) return Err('There are no components to collapse')
  const info = prepareCollapsedInfo(selected, graphStore.db)
  if (!info.ok) return info
  const currentMethodName = unwrapOr(graphStore.currentMethod.pointer, undefined)?.name
  if (currentMethodName == null) {
    bail(`Cannot get the method name for the current execution stack item.`)
  }
  const topLevel = module.root
  if (!topLevel) {
    bail('BUG: no top level, creating User Defined Component not possible.')
  }
  const selectedNodeRects = iter.filterDefined(iter.map(selected, graphStore.visibleArea))
  return module.edit((edit) => {
    const { collapsedCallRoot, collapsedNodeIds, outputAstId, collapsedName } = performCollapse(
      info.value,
      edit.getVersion(topLevel),
      graphStore.db,
      currentMethodName,
      options.name,
    )
    const collapsedCall = edit.get(collapsedCallRoot)
    const position = deps.placeCollapsedNode(selectedNodeRects)
    collapsedCall.mutableNodeMetadata().set('position', position.xy())

    const collapsedNodeRects = [
      ...iter.filterDefined(iter.map(collapsedNodeIds, graphStore.visibleArea)),
    ]
    const outputPosition = deps.placeOutputNode(collapsedNodeRects)
    edit.get(outputAstId).mutableNodeMetadata().set('position', outputPosition.xy())

    // The collapsed nodes leave this graph: what they were pushing returns.
    graphStore.releasePushedBy(selected, edit)
    // A node's id is the external id of its root expression: here, the call.
    return Ok({ name: collapsedName, callNode: asNodeId(collapsedCall.externalId) })
  })
}
