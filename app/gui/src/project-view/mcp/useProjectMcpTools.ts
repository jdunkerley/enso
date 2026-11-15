/**
 * @file Registers the MCP tools that read the open project with the window's dispatcher
 * (`$/mcp/toolDispatcher`) for as long as the calling scope (the graph editor) lives.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { useCurrentProject, type CurrentProjectStore } from '$/components/WithCurrentProject.vue'
import { registerMcpToolHandlers, type McpToolHandler } from '$/mcp/toolDispatcher'
import type { McpToolResult } from 'enso-common/src/mcp'
import { onScopeDispose } from 'vue'
import { evaluateExpression } from './evaluate'
import { getGraph, getNode, type GraphToolDeps } from './graphTools'

/**
 * Like `aiToolHandler.ts`: under the main-process MCP server's timeout, so that the window's own
 * error reaches the caller first.
 */
const EVALUATE_TIMEOUT_MS = 25_000

/**
 * Registers get_graph, get_node, evaluate_expression for the open project; removes them on scope
 * dispose. Each call reads the project's stores when it runs, so it sees the graph as it is then.
 */
export function useProjectMcpTools(
  currentProject: CurrentProjectStore = useCurrentProject(),
): void {
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

  const handlers: Record<string, McpToolHandler> = {
    get_graph: async (args) => {
      const previews = args.previews
      if (previews != null && typeof previews !== 'boolean') {
        return invalidArgument('previews', 'a boolean')
      }
      return getGraph(graphDeps(), previews != null ? { previews } : {})
    },
    get_node: async (args) => {
      const node_id = args.node_id
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      return getNode(graphDeps(), { node_id })
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
        },
        node_id != null ? { expression, node_id } : { expression },
      )
    },
  }
  onScopeDispose(registerMcpToolHandlers(handlers))
}

function invalidArgument(name: string, expected: string): McpToolResult {
  return { ok: false, error: `The argument \`${name}\` must be ${expected}.` }
}
