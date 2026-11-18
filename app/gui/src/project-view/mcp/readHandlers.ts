/**
 * @file The window handlers of the tools that read the project: `get_graph`, `get_node`,
 * `search_components`, `get_component_docs`, `evaluate_expression` and `get_problems`.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import { importedLibraries } from '$/providers/openedProjects/module/imports'
import type { Ast } from '@/util/ast'
import { getComponentDocs, searchComponents, type CatalogueDeps } from './catalogueTools'
import { evaluateExpression } from './evaluate'
import { getGraph, getNode, type GetGraphDeps } from './graphTools'
import { getProblems, type ProblemToolDeps } from './problemTools'
import { graphDeps, invalidArgument, isLive, type ProjectToolContext } from './projectToolContext'

/** Under the main-process MCP server's timeout, so that the window's own error reaches the caller first. */
const EVALUATE_TIMEOUT_MS = 25_000

/** The tools that read the project. */
export function readHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  const { currentProject, editor } = ctx

  function getGraphDeps(): GetGraphDeps {
    const graph = currentProject.graph.value
    return {
      ...graphDeps(ctx),
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

  return {
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
      return getNode(graphDeps(ctx), { node_id })
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
    get_problems: async () => getProblems(problemDeps()),
  }
}
