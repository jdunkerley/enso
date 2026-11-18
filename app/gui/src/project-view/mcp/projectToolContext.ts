/**
 * @file What the project tools' handler groups share: {@link ProjectToolContext}, which
 * `useProjectMcpTools` builds once per graph editor and hands to each group's `…Handlers`
 * function, what only the graph editor has ({@link McpEditorDeps}), and the helpers more than one
 * group needs.
 */
import type { CurrentProjectStore } from '$/components/WithCurrentProject.vue'
import type { useLocalVersioning } from '$/providers/localVersioning'
import type { GraphStore } from '$/providers/openedProjects/graph'
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { CollapseOutcome } from '@/components/GraphEditor/collapseNodes'
import type { Ast } from '@/util/ast'
import type { Rect } from '@/util/data/rect'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { Result } from 'enso-common/src/utilities/data/result'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'
import type { EditSession } from './editSession'
import type { GraphToolDeps } from './graphTools'
import type { AlignmentHandlers } from './layoutTools'
import { drawnVisualizationSize, type Edges, type VisualizationSize } from './visualizationTools'

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
 * What each handler group reads when a call runs. The stores are reached through
 * `currentProject` at call time: a handler never keeps a store or a snapshot of the graph between
 * calls.
 */
export interface ProjectToolContext {
  readonly editor: McpEditorDeps
  readonly currentProject: CurrentProjectStore
  readonly localVersioning: ReturnType<typeof useLocalVersioning>
  /** The editor's one edit session, which the edit tools run through. */
  readonly session: EditSession
  /**
   * Whether this editor is on screen: from setup (an editor mounts on screen) and each
   * `onActivated` until `onDeactivated`. An edit whose turn comes while it is hidden is refused.
   */
  readonly isActive: () => boolean
  /**
   * The root of the module in the editor (the project's `Main.enso`), read live from the module
   * store; undefined while it cannot be read.
   */
  readonly editorModuleRoot: () => Ast.Ast | undefined
}

/** The graph tools' dependencies, read when the call runs. */
export function graphDeps({ currentProject }: ProjectToolContext): GraphToolDeps {
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

/**
 * Whether the project is in Live mode: the mode, or the context's environment too, because the
 * watch in `project.ts` that moves the environment after the mode runs later, so for a moment the
 * two can differ.
 */
export function isLive(project: ProjectStore): boolean {
  return (
    project.executionMode === 'live' || project.executionContext.executionEnvironment === 'Live'
  )
}

/**
 * The size of the node's visualization as drawn: its stored size under the node's measured width
 * (0 before the node is measured, which leaves the 200 minimum).
 */
export function sizeOf(graph: GraphStore, id: NodeId): VisualizationSize {
  return drawnVisualizationSize(
    graph.db.nodeIdToNode.get(id)?.vis,
    graph.nodeBareSizes.get(id)?.x ?? 0,
  )
}

/** Resolves on the next animation frame, or after {@link FRAME_FALLBACK_MS} without one. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FRAME_FALLBACK_MS)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** The answer for an argument of the wrong type. */
export function invalidArgument(name: string, expected: string): McpToolResult {
  return { ok: false, error: `The argument \`${name}\` must be ${expected}.` }
}

/** Whether the value is a list of strings. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
