/**
 * @file The window handlers of the documentation tools, `get_documentation` and
 * `set_documentation`, and of `store_image` (which is not an MCP tool: main's `add_image` calls it).
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import { useProjectFiles } from '@/stores/projectFiles'
import type { McpCaller } from 'enso-common/src/mcp'
import { getDocumentation, setDocumentation, type SetDocumentationDeps } from './documentationTools'
import { findNode } from './graphTools'
import { serialized, storeImage, type ImageToolDeps } from './imageTools'
import { invalidArgument, type ProjectToolContext } from './projectToolContext'

/** The documentation tools and `store_image`. */
export function documentationHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  const { currentProject, session } = ctx

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

  return {
    get_documentation: async () => {
      const graph = currentProject.graph.value
      return getDocumentation({ db: graph.db, currentMethod: graph.currentMethod })
    },
    set_documentation: async (args, caller, deadline) => {
      const text = args.text
      if (typeof text !== 'string') return invalidArgument('text', 'a string')
      return setDocumentation(documentationDeps(caller, deadline), { text })
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
  }
}
