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
import { useProjectFiles } from '@/stores/projectFiles'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { Identifier } from '@/util/qualifiedName'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { onActivated, onDeactivated, onScopeDispose, watch } from 'vue'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'
import { getComponentDocs, searchComponents, type CatalogueDeps } from './catalogueTools'
import { getDocumentation, setDocumentation, type SetDocumentationDeps } from './documentationTools'
import { EditSession } from './editSession'
import {
  addNodes,
  editNode,
  removeNodes,
  setNodeComment,
  setVisualization,
  toolError,
  type EditToolDeps,
} from './editTools'
import { evaluateExpression } from './evaluate'
import { findNode, getGraph, getNode, type GetGraphDeps, type GraphToolDeps } from './graphTools'
import { redoTool, undoTool } from './historyTools'
import { serialized, storeImage, withProjectId, type ImageToolDeps } from './imageTools'
import {
  arrangeNodes,
  moveNodes,
  type AlignmentHandlers,
  type ArrangeToolDeps,
  type NodeMove,
} from './layoutTools'
import { createMcpNodes } from './nodeCreation'
import { panelQuiet } from './panelQuiet'
import { getProblems, type ProblemToolDeps } from './problemTools'
import {
  afterGraphUpdate,
  moduleChangedBy,
  onUserModuleTransaction,
  watchExecution,
  watchGraphUpdate,
} from './projectEvents'
import { refreshTool } from './refreshTool'
import { addFunction, collapseNodesTool, type StructureToolDeps } from './structureTools'
import { saveVersion } from './versionTools'
import { openMethod, prepareGraphImage, selectNodes, type ViewToolDeps } from './viewTools'
import { lookupVisualization } from './visualizationRegistry'
import {
  drawnVisualizationSize,
  getVisualizationData,
  listVisualizations,
  noSuchVisualizationError,
  prepareVisualization,
  type Edges,
  type VisualizationSize,
  type VisualizationToolDeps,
} from './visualizationTools'
import { writeRefusal } from './writeGuard'

/** Under the main-process MCP server's timeout, so that the window's own error reaches the caller first. */
const EVALUATE_TIMEOUT_MS = 25_000
/** How long to wait for a frame before going on without one: a hidden window draws none. */
const FRAME_FALLBACK_MS = 100

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
  /**
   * The zoom `viewport` is drawn at now (1 is 100%). During a zoom animation it is on its way to
   * {@link scale}, the zoom the view is going to.
   */
  readonly viewportScale: () => number
  /** The graph editor's "Group components", without its follow-up (the rename it schedules). */
  readonly collapseNodes: (
    ids: readonly NodeId[],
    name: Identifier | undefined,
  ) => Result<CollapseOutcome>
  /** The graph editor's viewport, in CSS pixels of the window's client area. */
  readonly viewRect: () => Edges
  /**
   * The part of the viewport no overlay covers (the top bar, the dock's buttons, the scroll bars),
   * in the same pixels (`clearArea` in `viewTools.ts`).
   */
  readonly clearViewRect: () => Edges
  /** The graph's zoom: 1 is 100%. */
  readonly scale: () => number
  /** Moves the view, without animation, to show this client rectangle at 100% where it fits. */
  readonly revealClientRect: (rect: Edges) => void
  /** Moves the view, without animation, to show this scene rectangle centred at `scale`. */
  readonly frameScene: (rect: Rect, scale: number) => void
  /** Whether the view is still moving. */
  readonly viewMoving: () => boolean
  /**
   * The visualizations the node's type offers, in the order of the visualization toolbar's
   * dropdown (the visualization store's `byType` for the node's type info).
   */
  readonly visualizationsFor: (nodeId: NodeId) => VisualizationIdentifier[]
  /** Tidy up (`useGraphTidy`): the given nodes when two or more, else the whole graph. */
  readonly tidy: (ids: readonly NodeId[] | undefined) => void
  /** The Align and Spacing handlers, without the menu's check of the panel's focus. */
  readonly alignment: AlignmentHandlers
}

/**
 * Registers the project tools for the open project: the eight that read (get_graph, get_node,
 * search_components, get_component_docs, evaluate_expression, list_visualizations,
 * get_documentation, get_problems), the fourteen that edit (undo, redo, save_version, refresh,
 * add_nodes, edit_node, remove_nodes, set_node_comment,
 * set_documentation, set_visualization, move_nodes, arrange_nodes, collapse_nodes, add_function)
 * and the two that navigate (select_nodes, open_method); the two that main's `get_visualization`
 * calls (get_visualization_data, prepare_visualization), the one main's `add_image` calls
 * (store_image) and the one main's `get_graph_image` calls (prepare_graph_image), which are not
 * MCP tools themselves.
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

  /**
   * The root of the module in the editor (the project's `Main.enso`), read live from the module
   * store; undefined while it cannot be read.
   */
  function editorModuleRoot(): Ast.Ast | undefined {
    return currentProject.module.value.ast?.root()
  }

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
    historyDepth: () => {
      const undoManager = currentProject.module.value.undoManager
      return { undo: undoManager.undoDepth, redo: undoManager.redoDepth }
    },
    undo: (floor) => currentProject.module.value.undoManager.undoAbove(floor),
    redo: (floor) => currentProject.module.value.undoManager.redoAbove(floor),
    enablesOutput: () => {
      const root = editorModuleRoot()
      return root == null || writeRefusal(root) != null
    },
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
    const graph = currentProject.graph.value
    return {
      ...graphDeps(),
      selection: editor.selectedNodes,
      area: (id) => graph.visibleArea(id),
      // The rectangle and the zoom of the same moment, even during a zoom animation.
      view: () => ({ rect: editor.viewport(), scale: editor.viewportScale() }),
    }
  }

  /** `get_problems`' dependencies, read when the call runs. */
  function problemDeps(): ProblemToolDeps {
    const graph = currentProject.graph.value
    const project = currentProject.store.value
    const source = currentProject.module.value.source
    const spanOf = (id: Ast.AstId | undefined) => (id != null ? source.getSpan(id) : undefined)
    return {
      db: graph.db,
      currentMethod: graph.currentMethod,
      // Reads reactive state (the lookup starts the error's small visualization), so that the
      // wait is told when the text arrives.
      dataflowErrorMessage: (id) => project.dataflowErrors.lookup(id)?.value?.message,
      diagnostics: () => project.diagnostics,
      methodRange: () => {
        const method = graph.currentMethod.ast
        return method.ok ? spanOf(method.value.id) : undefined
      },
      expressionRange: (id) => spanOf(graph.db.idFromExternal(id)),
      lineOf: (offset) => {
        const text = source.text
        let line = 1
        for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
          line++
        }
        return line
      },
      // The module on screen is the project's `src/Main.enso` (the segments the language server
      // sends, checked in the packaged app); a diagnostic about another file is not about it.
      isThisModule: (path) => path == null || path.segments.join('/') === 'src/Main.enso',
    }
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

  /** The layout tools' dependencies: positions are module metadata, edited through the session. */
  function layoutDeps(caller: McpCaller, deadline: number): ArrangeToolDeps {
    const graph = currentProject.graph.value
    return {
      db: graph.db,
      currentMethod: graph.currentMethod,
      session,
      caller,
      deadline,
      setNodePositions: (moves) => currentProject.graph.value.setNodePositions(moves),
      moduleChanged: (f) => moduleChangedBy(currentProject.module.value, f),
      tidy: editor.tidy,
      alignment: editor.alignment,
    }
  }

  /** `set_documentation`'s dependencies: one module edit, through the edit session. */
  function documentationDeps(caller: McpCaller, deadline: number): SetDocumentationDeps {
    const graph = currentProject.graph.value
    return {
      db: graph.db,
      currentMethod: graph.currentMethod,
      session,
      caller,
      deadline,
      editModule: (f) => currentProject.module.value.edit(f),
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

  /**
   * The visualization handlers' dependencies. Showing a hidden visualization, or switching to
   * another, goes through the edit session, as `set_visualization` does.
   */
  function visualizationDeps(caller: McpCaller, deadline: number): VisualizationToolDeps {
    const graph = currentProject.graph.value
    const panelRect = (nodeId: string) =>
      lookupVisualization(currentProject.id.value, nodeId)?.panel()?.getBoundingClientRect()
    return {
      findNode: (nodeId) => {
        const found = findNode(graph.db, nodeId)
        return found.ok ? { ok: true, value: found.value.id } : found
      },
      lookup: (nodeId) => lookupVisualization(currentProject.id.value, nodeId),
      isShown: (nodeId) => graph.db.nodeIdToNode.get(nodeId as NodeId)?.vis?.visible ?? false,
      storedName: (nodeId) => graph.db.nodeIdToNode.get(nodeId as NodeId)?.vis?.identifier?.name,
      // As `GraphNodes.vue` passes `edited` to the node, which then unmounts its visualization.
      isEdited: (nodeId) => graph.editedNodeInfo?.id === nodeId,
      availableNames: (nodeId) =>
        editor.visualizationsFor(nodeId as NodeId).map((identifier) => identifier.name),
      size: (nodeId) => sizeOf(currentProject.graph.value, nodeId as NodeId),
      show: (nodeId, visualization) => {
        // Two visualizations of the same name from different modules: the first in the
        // dropdown's order, which is the one `availableNames` lists first.
        const offered = editor.visualizationsFor(nodeId as NodeId)
        const identifier =
          visualization != null ?
            offered.find((candidate) => candidate.name === visualization)
          : undefined
        // The node's type may have changed since the name was checked: never show it unswitched.
        if (visualization != null && identifier == null) {
          const names = offered.map((candidate) => candidate.name)
          return Promise.resolve(toolError(noSuchVisualizationError(visualization, names)))
        }
        return setVisualization(editDeps(caller, deadline), {
          node_id: nodeId,
          visible: true,
          ...(identifier != null ? { identifier } : {}),
        })
      },
      panelRect,
      viewRect: editor.viewRect,
      scale: editor.scale,
      reveal: (nodeId) => {
        const rect = panelRect(nodeId)
        if (rect != null) editor.revealClientRect(rect)
      },
      viewMoving: editor.viewMoving,
      nextFrame,
      panelQuiet: (nodeId, budgetMs) =>
        panelQuiet(lookupVisualization(currentProject.id.value, nodeId)?.panel(), budgetMs),
      now: () => Date.now(),
      deadline,
    }
  }

  /**
   * `store_image`'s dependencies: the project's file functions, as the documentation editor's
   * upload uses them, and the node names for a picture's default name.
   */
  function imageDeps(deadline: number): ImageToolDeps {
    const graph = currentProject.graph.value
    return {
      files: useProjectFiles(currentProject.store.value),
      nodeName: (nodeId) => {
        const found = findNode(graph.db, nodeId)
        return found.ok ? found.value.node.pattern?.code() : undefined
      },
      projectId: () => currentProject.id.value,
      now: () => Date.now(),
      deadline,
    }
  }
  // One store at a time: two images of the same name must not pick the same free name.
  const storeImageInTurn = serialized(storeImage)

  const handlers: Record<string, McpToolHandler> = {
    get_graph: async (args) => {
      const { previews, layout } = args
      if (previews != null && typeof previews !== 'boolean') {
        return invalidArgument('previews', 'a boolean')
      }
      if (layout != null && typeof layout !== 'boolean') {
        return invalidArgument('layout', 'a boolean')
      }
      return getGraph(getGraphDeps(), {
        ...(previews != null ? { previews } : {}),
        ...(layout != null ? { layout } : {}),
      })
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
          // On timeout, interrupt the execution context so that the
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
    get_documentation: async () => {
      const graph = currentProject.graph.value
      return getDocumentation({ db: graph.db, currentMethod: graph.currentMethod })
    },
    set_documentation: async (args, caller, deadline) => {
      const text = args.text
      if (typeof text !== 'string') return invalidArgument('text', 'a string')
      return setDocumentation(documentationDeps(caller, deadline), { text })
    },
    set_visualization: async (args, caller, deadline) => {
      const { node_id, visible, width, height } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (typeof visible !== 'boolean') return invalidArgument('visible', 'a boolean')
      if (!isSizeArgument(width)) return invalidArgument('width', 'a number or null')
      if (!isSizeArgument(height)) return invalidArgument('height', 'a number or null')
      return setVisualization(editDeps(caller, deadline), {
        node_id,
        visible,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      })
    },
    move_nodes: async (args, caller, deadline) => {
      const moves = args.moves
      if (!Array.isArray(moves) || !moves.every(isNodeMove)) {
        return invalidArgument('moves', 'a list of `{ node_id, x, y }`')
      }
      return moveNodes(layoutDeps(caller, deadline), { moves })
    },
    arrange_nodes: async (args, caller, deadline) => {
      const { action, node_ids } = args
      if (typeof action !== 'string') return invalidArgument('action', 'a string')
      if (node_ids != null && !isStringArray(node_ids)) {
        return invalidArgument('node_ids', 'a list of strings')
      }
      return arrangeNodes(layoutDeps(caller, deadline), {
        action,
        ...(node_ids != null ? { node_ids } : {}),
      })
    },
    save_version: async (args, caller) => {
      const comment = args.comment
      if (comment != null && typeof comment !== 'string') {
        return invalidArgument('comment', 'a string')
      }
      // Not through the edit session: a version changes no module. `status` is read when the
      // call runs, and a project whose versions are not kept is refused before `save` is called,
      // which would otherwise offer to turn them on.
      const projectId = currentProject.store.value.assetId
      return saveVersion(
        {
          caller,
          isActive: () => active,
          status: () => localVersioning.statusOf(projectId),
          save: (text) => localVersioning.save(projectId, text),
        },
        comment != null ? { comment } : {},
      )
    },
    get_problems: async () => getProblems(problemDeps()),
    refresh: async (_args, caller, deadline) => {
      const graph = currentProject.graph.value
      const project = currentProject.store.value
      return refreshTool({
        session,
        caller,
        deadline,
        // Read at the run's turn, as the session does.
        isLive: () => isLive(currentProject.store.value),
        db: graph.db,
        // The same module the session checks before undo and redo.
        moduleRoot: editorModuleRoot,
        executionContext: project.executionContext,
      })
    },
    undo: async (_args, caller, deadline) => undoTool({ session, caller, deadline }),
    redo: async (_args, caller, deadline) => redoTool({ session, caller, deadline }),
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
    list_visualizations: async (args, caller, deadline) => {
      const node_id = args.node_id
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      return listVisualizations(visualizationDeps(caller, deadline), { node_id })
    },
    get_visualization_data: async (args, caller, deadline) => {
      const { node_id, visualization } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (visualization != null && typeof visualization !== 'string') {
        return invalidArgument('visualization', 'a string')
      }
      return getVisualizationData(visualizationDeps(caller, deadline), {
        node_id,
        ...(visualization != null ? { visualization } : {}),
      })
    },
    store_image: async (args, _caller, deadline) => {
      const { data, name, node_id, project_id } = args
      if (typeof data !== 'string') return invalidArgument('data', 'a string')
      if (name != null && typeof name !== 'string') return invalidArgument('name', 'a string')
      if (node_id != null && typeof node_id !== 'string') {
        return invalidArgument('node_id', 'a string')
      }
      if (project_id != null && typeof project_id !== 'string') {
        return invalidArgument('project_id', 'a string')
      }
      return storeImageInTurn(imageDeps(deadline), {
        data,
        ...(name != null ? { name } : {}),
        ...(node_id != null ? { node_id } : {}),
        ...(project_id != null ? { project_id } : {}),
      })
    },
    prepare_graph_image: async (args, _caller, deadline) => {
      const node_ids = args.node_ids
      if (node_ids != null && !isStringArray(node_ids)) {
        return invalidArgument('node_ids', 'a list of strings')
      }
      const graph = currentProject.graph.value
      return prepareGraphImage(
        {
          db: graph.db,
          area: (id) => graph.visibleArea(id),
          viewRect: editor.viewRect,
          clearRect: editor.clearViewRect,
          viewport: editor.viewport,
          scale: editor.scale,
          frame: editor.frameScene,
          viewMoving: editor.viewMoving,
          nextFrame,
          now: () => Date.now(),
          deadline,
        },
        node_ids != null ? { node_ids } : {},
      )
    },
    prepare_visualization: async (args, caller, deadline) => {
      const { node_id, visualization } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (visualization != null && typeof visualization !== 'string') {
        return invalidArgument('visualization', 'a string')
      }
      const prepared = await prepareVisualization(visualizationDeps(caller, deadline), {
        node_id,
        ...(visualization != null ? { visualization } : {}),
      })
      // Which project took the picture: `add_image` stores it there only. Main does not pass it
      // on to the agent.
      return withProjectId(prepared, currentProject.id.value)
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

/**
 * The size of the node's visualization as drawn: its stored size under the node's measured width
 * (0 before the node is measured, which leaves the 200 minimum).
 */
function sizeOf(graph: GraphStore, id: NodeId): VisualizationSize {
  return drawnVisualizationSize(
    graph.db.nodeIdToNode.get(id)?.vis,
    graph.nodeBareSizes.get(id)?.x ?? 0,
  )
}

/** The node's area on screen; its position alone before it has been rendered. */
function nodeArea(graph: GraphStore, id: NodeId): Rect | undefined {
  const area = graph.visibleArea(id)
  if (area != null) return area
  const position = graph.db.nodeIdToNode.get(id)?.position
  return position != null ? new Rect(position, Vec2.Zero) : undefined
}

/** Resolves on the next animation frame, or after {@link FRAME_FALLBACK_MS} without one. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FRAME_FALLBACK_MS)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function isNodeMove(value: unknown): value is NodeMove {
  if (typeof value !== 'object' || value == null) return false
  const { node_id, x, y } = value as Record<string, unknown>
  return typeof node_id === 'string' && typeof x === 'number' && typeof y === 'number'
}

/** A visualization size argument: a number, null (the default) or absent. */
function isSizeArgument(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function invalidArgument(name: string, expected: string): McpToolResult {
  return { ok: false, error: `The argument \`${name}\` must be ${expected}.` }
}
