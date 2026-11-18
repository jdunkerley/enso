/**
 * @file The window handlers of the tools about history and the project's run: `undo`, `redo`,
 * `save_version` and `refresh`.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import { useProjectFiles } from '@/stores/projectFiles'
import { toolError } from './editTools'
import { redoTool, undoTool } from './historyTools'
import { enablesOutputInOtherModules } from './otherModules'
import { invalidArgument, isLive, type ProjectToolContext } from './projectToolContext'
import { refreshTool } from './refreshTool'
import { saveVersion } from './versionTools'

/** `undo`, `redo`, `save_version` and `refresh`. */
export function historyHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  const { currentProject, localVersioning, session } = ctx

  /**
   * Why `undo`, `redo` and `refresh` are refused because of the project's modules other than
   * `Main.enso` (see `otherModules.ts`; library code is not checked).
   */
  function otherModulesRefusal(): Promise<string | undefined> {
    return enablesOutputInOtherModules(useProjectFiles(currentProject.store.value))
  }

  return {
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
          isActive: ctx.isActive,
          status: () => localVersioning.statusOf(projectId),
          save: (text) => localVersioning.save(projectId, text),
        },
        comment != null ? { comment } : {},
      )
    },
    refresh: async (_args, caller, deadline) => {
      const otherModules = await otherModulesRefusal()
      if (otherModules != null) return toolError(otherModules)
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
        moduleRoot: ctx.editorModuleRoot,
        executionContext: project.executionContext,
      })
    },
    undo: async (_args, caller, deadline) => {
      const otherModules = await otherModulesRefusal()
      if (otherModules != null) return toolError(otherModules)
      return undoTool({ session, caller, deadline })
    },
    redo: async (_args, caller, deadline) => {
      const otherModules = await otherModulesRefusal()
      if (otherModules != null) return toolError(otherModules)
      return redoTool({ session, caller, deadline })
    },
  }
}
