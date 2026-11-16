/**
 * @file Registers the open project's MCP tools with the window's dispatcher
 * (`$/mcp/toolDispatcher`) for as long as the calling scope (the graph editor) lives, and builds
 * the edit session that the edit tools run through.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { useCurrentProject, type CurrentProjectStore } from '$/components/WithCurrentProject.vue'
import { registerMcpToolHandlers, type McpToolHandler } from '$/mcp/toolDispatcher'
import { useLocalVersioning } from '$/providers/localVersioning'
import type { GraphStore } from '$/providers/openedProjects/graph'
import { nodeIdFromOuterAst, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { importedLibraries } from '$/providers/openedProjects/module/imports'
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { CollapseOutcome } from '@/components/GraphEditor/collapseNodes'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { Identifier } from '@/util/qualifiedName'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { onActivated, onDeactivated, onScopeDispose, watch } from 'vue'
import { getComponentDocs, searchComponents, type CatalogueDeps } from './catalogueTools'
import { EditSession } from './editSession'
import {
  addNodes,
  editNode,
  removeNodes,
  setNodeComment,
  setVisualization,
  type EditToolDeps,
} from './editTools'
import { evaluateExpression } from './evaluate'
import { getGraph, getNode, type GetGraphDeps, type GraphToolDeps } from './graphTools'
import { createMcpNodes } from './nodeCreation'
import {
  afterGraphUpdate,
  onUserModuleTransaction,
  watchExecution,
  watchGraphUpdate,
} from './projectEvents'
import { addFunction, collapseNodesTool, type StructureToolDeps } from './structureTools'
import { openMethod, selectNodes, type ViewToolDeps } from './viewTools'

/**
 * Like `aiToolHandler.ts`: under the main-process MCP server's timeout, so that the window's own
 * error reaches the caller first.
 */
const EVALUATE_TIMEOUT_MS = 25_000
/** What only the graph editor has: its selection, its view and its navigation. */
export interface McpEditorDeps {
  readonly selectedNodes: () => Iterable<NodeId>
  /** Makes these the selected nodes and pans to them; `[]` clears the selection. */
  readonly selectNodes: (ids: readonly NodeId[]) => void
  readonly enterNode: (id: NodeId) => void
  readonly canLeaveMethod: () => boolean
  readonly leaveMethod: () => void
  /** The visible part of the scene. */
  readonly viewport: () => Rect
  /** The graph editor's "Group components", without its follow-up (the rename it schedules). */
  readonly collapseNodes: (
    ids: readonly NodeId[],
    name: Identifier | undefined,
  ) => Result<CollapseOutcome>
}

/**
 * Registers the project tools for the open project: the five that read (get_graph, get_node,
 * search_components, get_component_docs, evaluate_expression), the seven that edit (add_nodes,
 * edit_node, remove_nodes, set_node_comment, set_visualization, collapse_nodes, add_function) and
 * the two that navigate (select_nodes, open_method).
 *
 * Every open project's graph editor stays mounted (the tabs are under `<KeepAlive>`), so the tools
 * must answer for the one on screen: this project's handlers are put first on activation and
 * removed on deactivation (another tab, or the dashboard, is showing) and on scope dispose. Each
 * call reads the project's stores when it runs, so it sees the graph and the catalogue as they
 * are then. The edit tools share one {@link EditSession}: its open undo step ends when the editor
 * is deactivated, and the session is disposed with the scope.
 */
export function useProjectMcpTools(
  editor: McpEditorDeps,
  currentProject: CurrentProjectStore = useCurrentProject(),
): void {
  const localVersioning = useLocalVersioning()
  /**
   * Whether this editor is on screen: from setup (an editor mounts on screen) and each
   * `onActivated` until `onDeactivated`. An edit whose turn comes while it is hidden is refused.
   */
  let active = true

  const session = new EditSession({
    isLive: () => isLive(currentProject.store.value),
    isActive: () => active,
    holdUndoStep: () => {
      const undoManager = currentProject.module.value.undoManager
      // A step held by something else (a node drag) does not end when ours starts or ends: end
      // it here, so that the agent's edits and the user's never share a step.
      undoManager.undoStackBoundary()
      const release = undoManager.holdStep()
      return () => {
        release()
        undoManager.undoStackBoundary()
      }
    },
    onForeignEdit: (listener) =>
      onUserModuleTransaction(
        () => currentProject.module.value,
        (source, callback) => watch(source, callback, { flush: 'sync' }),
        listener,
      ),
    saveVersion: (comment) =>
      localVersioning.saveIfEnabled(currentProject.store.value.assetId, comment),
    watchGraphUpdate: () => watchGraphUpdate(currentProject.graph.value),
    watchExecution: () => watchExecution(currentProject.store.value.executionContext),
    now: () => Date.now(),
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })

  function graphDeps(): GraphToolDeps {
    const graph = currentProject.graph.value
    const project = currentProject.store.value
    const projectNames = currentProject.projectNames.value
    return {
      db: graph.db,
      currentMethod: graph.currentMethod,
      moduleRoot: () => {
        const ast = graph.currentMethod.ast
        return ast.ok ? ast.value.module.root() : undefined
      },
      printType: (type) => projectNames.printProjectPath(type),
      // No interrupt on timeout here: an interrupt stops everything running in the execution
      // context, which a preview that is merely slow does not justify.
      evaluate: (scope, expression, timeoutMs) =>
        project.queuedExecuteExpressionRaw(scope, expression, timeoutMs),
    }
  }

  function getGraphDeps(): GetGraphDeps {
    return { ...graphDeps(), selection: editor.selectedNodes }
  }

  function catalogueDeps(): CatalogueDeps {
    const suggestionDb = currentProject.suggestionDb.value
    const projectNames = currentProject.projectNames.value
    // The module's imports, as `ComponentList.vue` reads them.
    const root = currentProject.module.value.root
    return {
      db: suggestionDb.entries,
      loaded: suggestionDb.loaded,
      projectNames,
      importedLibraries: root ? importedLibraries(root, projectNames) : new Set(),
    }
  }

  /**
   * The edit tools' dependencies. Each function reads the stores when it is called: an edit runs at
   * its turn in the session's queue, which may be after other edits.
   */
  function editDeps(caller: McpCaller, deadline: number): EditToolDeps {
    const graph = () => currentProject.graph.value
    const module = () => currentProject.module.value
    return {
      ...graphDeps(),
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
      setVisualization: (id, visible) => {
        const g = graph()
        if (!g.db.nodeIdToNode.has(id)) return Err(`No node ${id}`)
        g.setNodeVisualization(id, { visible })
        return Ok()
      },
    }
  }

  function structureDeps(caller: McpCaller, deadline: number): StructureToolDeps {
    const module = () => currentProject.module.value
    return {
      ...graphDeps(),
      session,
      caller,
      deadline,
      collapseNodes: editor.collapseNodes,
      editModule: (f) =>
        module().edit((edit) => {
          const topLevel = edit.root()
          if (!(topLevel instanceof Ast.MutableBodyBlock)) {
            return Err('The module has no top-level block.')
          }
          return f(topLevel)
        }),
      addDetectedImports: (edit, scope) => {
        module().addDetectedImports(edit, scope)
      },
    }
  }

  function viewDeps(): ViewToolDeps {
    const graph = currentProject.graph.value
    return {
      db: graph.db,
      select: editor.selectNodes,
      selected: editor.selectedNodes,
      nodeCanBeEntered: (id) => graph.nodeCanBeEntered(id),
      enterNode: editor.enterNode,
      canLeave: editor.canLeaveMethod,
      leaveMethod: editor.leaveMethod,
      waitForGraph: (timeoutMs) => afterGraphUpdate(currentProject.graph.value, timeoutMs),
      currentMethodName: () => {
        const pointer = currentProject.graph.value.currentMethod.pointer
        return pointer.ok ? pointer.value.name : undefined
      },
      contextChanged: () => session.releaseStep(),
    }
  }

  const handlers: Record<string, McpToolHandler> = {
    get_graph: async (args) => {
      const previews = args.previews
      if (previews != null && typeof previews !== 'boolean') {
        return invalidArgument('previews', 'a boolean')
      }
      return getGraph(getGraphDeps(), previews != null ? { previews } : {})
    },
    get_node: async (args) => {
      const node_id = args.node_id
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      return getNode(graphDeps(), { node_id })
    },
    search_components: async (args) => {
      const { query, self_type, limit } = args
      if (typeof query !== 'string') return invalidArgument('query', 'a string')
      if (self_type != null && typeof self_type !== 'string') {
        return invalidArgument('self_type', 'a string')
      }
      if (limit != null && typeof limit !== 'number') return invalidArgument('limit', 'a number')
      return searchComponents(catalogueDeps(), {
        query,
        ...(self_type != null ? { self_type } : {}),
        ...(limit != null ? { limit } : {}),
      })
    },
    get_component_docs: async (args) => {
      const name = args.name
      if (typeof name !== 'string') return invalidArgument('name', 'a string')
      return getComponentDocs(catalogueDeps(), { name })
    },
    evaluate_expression: async (args) => {
      const { expression, node_id } = args
      if (typeof expression !== 'string') return invalidArgument('expression', 'a string')
      if (node_id != null && typeof node_id !== 'string') {
        return invalidArgument('node_id', 'a string')
      }
      const project = currentProject.store.value
      const graph = currentProject.graph.value
      return evaluateExpression(
        {
          db: graph.db,
          currentMethod: graph.currentMethod,
          // As `aiToolHandler.ts` does: on timeout, interrupt the execution context so that the
          // abandoned evaluation does not hold up the next call.
          evaluateRaw: (scope, text) =>
            project.queuedExecuteExpressionRaw(scope, text, EVALUATE_TIMEOUT_MS, () => {
              void project.lsRpcConnection.interruptExecutionContext(project.executionContext.id)
            }),
          isLive: () => isLive(project),
        },
        node_id != null ? { expression, node_id } : { expression },
      )
    },
    add_nodes: async (args, caller, deadline) => {
      const { statements, after_node, imports } = args
      if (!isStringArray(statements)) return invalidArgument('statements', 'a list of strings')
      if (after_node != null && typeof after_node !== 'string') {
        return invalidArgument('after_node', 'a string')
      }
      if (imports != null && !isStringArray(imports)) {
        return invalidArgument('imports', 'a list of strings')
      }
      return addNodes(editDeps(caller, deadline), {
        statements,
        ...(after_node != null ? { after_node } : {}),
        ...(imports != null ? { imports } : {}),
      })
    },
    edit_node: async (args, caller, deadline) => {
      const { node_id, expression } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof expression !== 'string') return invalidArgument('expression', 'a string')
      return editNode(editDeps(caller, deadline), { node_id, expression })
    },
    remove_nodes: async (args, caller, deadline) => {
      const node_ids = args.node_ids
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      return removeNodes(editDeps(caller, deadline), { node_ids })
    },
    set_node_comment: async (args, caller, deadline) => {
      const { node_id, text } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof text !== 'string') return invalidArgument('text', 'a string')
      return setNodeComment(editDeps(caller, deadline), { node_id, text })
    },
    set_visualization: async (args, caller, deadline) => {
      const { node_id, visible } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof visible !== 'boolean') return invalidArgument('visible', 'a boolean')
      return setVisualization(editDeps(caller, deadline), { node_id, visible })
    },
    collapse_nodes: async (args, caller, deadline) => {
      const { node_ids, name } = args
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      if (name != null && typeof name !== 'string') return invalidArgument('name', 'a string')
      return collapseNodesTool(structureDeps(caller, deadline), {
        node_ids,
        ...(name != null ? { name } : {}),
      })
    },
    add_function: async (args, caller, deadline) => {
      const source = args.source
      if (typeof source !== 'string') return invalidArgument('source', 'a string')
      return addFunction(structureDeps(caller, deadline), { source })
    },
    select_nodes: async (args) => {
      const node_ids = args.node_ids
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      return selectNodes(viewDeps(), { node_ids })
    },
    open_method: async (args) => {
      const node_id = args.node_id
      if (node_id != null && typeof node_id !== 'string') {
        return invalidArgument('node_id', 'a string')
      }
      return openMethod(viewDeps(), node_id != null ? { node_id } : {})
    },
  }
  // The project id is read when asked for, not kept: an editor stays with one project (its tab is
  // keyed by the project's id), so this is only belt and braces.
  const registration = registerMcpToolHandlers(handlers, () => currentProject.id.value)
  onActivated(() => {
    active = true
    registration.activate()
  })
  onDeactivated(() => {
    active = false
    registration.remove()
    // The user left this project: an agent's next edit here is a step of its own.
    session.releaseStep()
  })
  onScopeDispose(() => {
    registration.remove()
    session.dispose()
  })
}

/**
 * Whether the project is in Live mode: the mode, or the context's environment too, because the
 * watch in `project.ts` that moves the environment after the mode runs later, so for a moment the
 * two can differ.
 */
function isLive(project: ProjectStore): boolean {
  return (
    project.executionMode === 'live' || project.executionContext.executionEnvironment === 'Live'
  )
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function invalidArgument(name: string, expected: string): McpToolResult {
  return { ok: false, error: `The argument \`${name}\` must be ${expected}.` }
}
