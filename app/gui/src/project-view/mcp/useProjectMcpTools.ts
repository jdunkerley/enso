/**
 * @file Registers the open project's MCP tools with the window's dispatcher
 * (`$/mcp/toolDispatcher`) for as long as the calling scope (the graph editor) lives, and builds
 * the edit session that the edit tools run through. The handlers themselves are in one module per
 * tool group (`readHandlers.ts`, `editHandlers.ts`, `structureHandlers.ts`, `layoutHandlers.ts`,
 * `viewHandlers.ts`, `historyHandlers.ts`, `documentationHandlers.ts`, `visualizationHandlers.ts`),
 * each over the {@link ProjectToolContext} built here.
 */
import { useCurrentProject, type CurrentProjectStore } from '$/components/WithCurrentProject.vue'
import { registerMcpToolHandlers, type McpToolHandler } from '$/mcp/toolDispatcher'
import { useLocalVersioning } from '$/providers/localVersioning'
import type { Ast } from '@/util/ast'
import { onActivated, onDeactivated, onScopeDispose, watch } from 'vue'
import { documentationHandlers } from './documentationHandlers'
import { editHandlers } from './editHandlers'
import { EditSession } from './editSession'
import { historyHandlers } from './historyHandlers'
import { layoutHandlers } from './layoutHandlers'
import { onUserModuleTransaction, watchExecution, watchGraphUpdate } from './projectEvents'
import { isLive, type McpEditorDeps, type ProjectToolContext } from './projectToolContext'
import { readHandlers } from './readHandlers'
import { markingRefusals } from './refusals'
import { structureHandlers } from './structureHandlers'
import { viewHandlers } from './viewHandlers'
import { visualizationHandlers } from './visualizationHandlers'
import { writeRefusal } from './writeGuard'

export type { McpEditorDeps } from './projectToolContext'

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

  const context: ProjectToolContext = {
    editor,
    currentProject,
    localVersioning,
    session,
    isActive: () => active,
    editorModuleRoot,
  }

  const handlers: Record<string, McpToolHandler> = {
    ...readHandlers(context),
    ...editHandlers(context),
    ...documentationHandlers(context),
    ...layoutHandlers(context),
    ...historyHandlers(context),
    ...structureHandlers(context),
    ...viewHandlers(context),
    ...visualizationHandlers(context),
  }
  // The project id is read when asked for, not kept: an editor stays with one project (its tab is
  // keyed by the project's id), so this is only belt and braces.
  const registration = registerMcpToolHandlers(
    Object.fromEntries(
      Object.entries(handlers).map(([tool, handler]) => [tool, markingRefusals(handler)]),
    ),
    () => currentProject.id.value,
  )
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
