/**
 * @file The window handlers of the tools that edit nodes: `add_nodes`, `edit_node`,
 * `remove_nodes`, `set_node_comment` and `set_visualization`. {@link editDeps} is also what the
 * visualization handlers show a hidden visualization through.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import type { GraphStore } from '$/providers/openedProjects/graph'
import { nodeIdFromOuterAst, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { McpCaller } from 'enso-common/src/mcp'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import {
  addNodes,
  editNode,
  removeNodes,
  setNodeComment,
  setVisualization,
  type EditToolDeps,
} from './editTools'
import { createMcpNodes } from './nodeCreation'
import {
  graphDeps,
  invalidArgument,
  isStringArray,
  sizeOf,
  type ProjectToolContext,
} from './projectToolContext'

/**
 * The edit tools' dependencies. Each function reads the stores when it is called: an edit runs at
 * its turn in the session's queue, which may be after other edits.
 */
export function editDeps(
  ctx: ProjectToolContext,
  caller: McpCaller,
  deadline: number,
): EditToolDeps {
  const { currentProject, editor, session } = ctx
  const graph = () => currentProject.graph.value
  const module = () => currentProject.module.value
  return {
    ...graphDeps(ctx),
    session,
    caller,
    deadline,
    createNodes: async (nodes, after, importLines) => {
      const g = graph()
      const m = module()
      const anchor = after ?? lastNode(g)
      const created = createMcpNodes(
        {
          editModule: (f) => m.edit(f),
          methodAst: g.currentMethod.ast,
          addDetectedImports: (edit, scope) => {
            m.addDetectedImports(edit, scope)
          },
          generateName: (prefix, taken) => g.generateLocallyUniqueIdent(prefix, taken),
          nodeAreas: g.visibleNodeAreas,
          anchorArea: anchor != null ? nodeArea(g, anchor) : undefined,
          viewport: editor.viewport(),
        },
        nodes,
        importLines,
      )
      if (!created.ok) return created
      // As `useNodeCreation` does: the next placement avoids them before they are rendered.
      for (const { id, position } of created.value) {
        g.nodeRects.set(id, new Rect(position, Vec2.Zero))
      }
      return Ok(created.value.map(({ id }) => id))
    },
    setNodeContent: (id, expression) => graph().setNodeContent(id, expression),
    deleteNodes: (ids) => graph().deleteNodes(ids),
    setNodeComment: (id, text) => {
      const node = graph().db.nodeIdToNode.get(id)
      if (node == null) return Err(`No node ${id}`)
      return module().edit((edit) => {
        const statement = edit.getVersion(node.outerAst)
        const documentation =
          statement.isStatement() ? statement.mutableDocumentationText?.() : undefined
        if (documentation == null) return Err(`Node ${id} cannot have a comment.`)
        documentation.delete(0, documentation.length)
        if (text !== '') documentation.insert(0, text)
        return Ok()
      })
    },
    setVisualization: (id, update) => {
      const g = graph()
      if (!g.db.nodeIdToNode.has(id)) return Err(`No node ${id}`)
      // As choosing one in the toolbar writes it (the identifier in the node's metadata), and as
      // a resize handle writes the size: one call, which also pushes or releases the neighbours.
      g.setNodeVisualization(id, update)
      return Ok()
    },
    visualizationSize: (id) => sizeOf(graph(), id),
  }
}

/** The node-editing tools. */
export function editHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  return {
    add_nodes: async (args, caller, deadline) => {
      const { statements, after_node, imports } = args
      if (!isStringArray(statements)) return invalidArgument('statements', 'a list of strings')
      if (after_node != null && typeof after_node !== 'string') {
        return invalidArgument('after_node', 'a string')
      }
      if (imports != null && !isStringArray(imports)) {
        return invalidArgument('imports', 'a list of strings')
      }
      return addNodes(editDeps(ctx, caller, deadline), {
        statements,
        ...(after_node != null ? { after_node } : {}),
        ...(imports != null ? { imports } : {}),
      })
    },
    edit_node: async (args, caller, deadline) => {
      const { node_id, expression } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof expression !== 'string') return invalidArgument('expression', 'a string')
      return editNode(editDeps(ctx, caller, deadline), { node_id, expression })
    },
    remove_nodes: async (args, caller, deadline) => {
      const node_ids = args.node_ids
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      return removeNodes(editDeps(ctx, caller, deadline), { node_ids })
    },
    set_node_comment: async (args, caller, deadline) => {
      const { node_id, text } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof text !== 'string') return invalidArgument('text', 'a string')
      return setNodeComment(editDeps(ctx, caller, deadline), { node_id, text })
    },
    set_visualization: async (args, caller, deadline) => {
      const { node_id, visible, width, height } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof visible !== 'boolean') return invalidArgument('visible', 'a boolean')
      if (!isSizeArgument(width)) return invalidArgument('width', 'a number or null')
      if (!isSizeArgument(height)) return invalidArgument('height', 'a number or null')
      return setVisualization(editDeps(ctx, caller, deadline), {
        node_id,
        visible,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      })
    },
  }
}

/** The last node of the method on screen, in code order. */
function lastNode(graph: GraphStore): NodeId | undefined {
  const method = graph.currentMethod.ast
  if (!method.ok) return undefined
  let last: NodeId | undefined
  for (const expression of method.value.bodyExpressions()) {
    const id = nodeIdFromOuterAst(expression)
    if (id != null && graph.db.isNodeId(id)) last = id
  }
  return last
}

/** The node's area on screen; its position alone before it has been rendered. */
function nodeArea(graph: GraphStore, id: NodeId): Rect | undefined {
  const area = graph.visibleArea(id)
  if (area != null) return area
  const position = graph.db.nodeIdToNode.get(id)?.position
  return position != null ? new Rect(position, Vec2.Zero) : undefined
}

/** A visualization size argument: a number, null (the default) or absent. */
function isSizeArgument(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number'
}
