/** @file The window handlers of the tools that restructure the module: `collapse_nodes` and `add_function`. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import { Ast } from '@/util/ast'
import type { McpCaller } from 'enso-common/src/mcp'
import { Err } from 'enso-common/src/utilities/data/result'
import {
  graphDeps,
  invalidArgument,
  isStringArray,
  type ProjectToolContext,
} from './projectToolContext'
import { addFunction, collapseNodesTool, type StructureToolDeps } from './structureTools'

function structureDeps(
  ctx: ProjectToolContext,
  caller: McpCaller,
  deadline: number,
): StructureToolDeps {
  const { currentProject, editor, session } = ctx
  const module = () => currentProject.module.value
  return {
    ...graphDeps(ctx),
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

/** `collapse_nodes` and `add_function`. */
export function structureHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  return {
    collapse_nodes: async (args, caller, deadline) => {
      const { node_ids, name } = args
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      if (name != null && typeof name !== 'string') return invalidArgument('name', 'a string')
      return collapseNodesTool(structureDeps(ctx, caller, deadline), {
        node_ids,
        ...(name != null ? { name } : {}),
      })
    },
    add_function: async (args, caller, deadline) => {
      const source = args.source
      if (typeof source !== 'string') return invalidArgument('source', 'a string')
      return addFunction(structureDeps(ctx, caller, deadline), { source })
    },
  }
}
