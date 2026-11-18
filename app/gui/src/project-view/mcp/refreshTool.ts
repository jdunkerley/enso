/**
 * @file The `refresh` MCP tool: computes every node again in Design mode, as the user's Refresh
 * button does. Pure functions over {@link RefreshToolDeps}.
 *
 * The one engine call is `executionContext.recompute('all')`, with that one argument: never an
 * execution environment (so the context keeps the one it has, Design, because Live is refused),
 * never per-expression configs and never `recomputeOnce` or `nodeExecution.recomputeAll('Live')`,
 * which are how the user's Write button and Live mode run a node with output enabled. Every
 * refusal is checked inside the session's action, at the run's turn, and nothing is called when one
 * applies.
 */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import type { ExecutionContext } from '$/providers/openedProjects/project/executionContext'
import type { Ast } from '@/util/ast'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import type { EditSession } from './editSession'
import { errorResult, settledResult, toolError } from './editTools'
import { writeRefusal } from './writeGuard'

/** The answer to `refresh` while the project is in Live mode. */
export const LIVE_REFRESH_ERROR =
  'The project is in Live mode, where a refresh writes outputs. Ask the user to refresh, or to switch the project back to Design.'
/** The answer to `refresh` when the project's main module has code that enables output. */
export const WRITE_ON_REFRESH_ERROR =
  "The project's main module has code that enables output, and a refresh would run it and write again. Ask the user to refresh."
/** The answer to `refresh` when the module on screen cannot be read. */
export const NO_MODULE_ERROR = 'The module on screen cannot be read now. Try again in a moment.'

/** What `refresh` reads and does. */
export interface RefreshToolDeps {
  /** The edit session, whose unstepped path queues the refresh and waits for its results. */
  readonly session: Pick<EditSession, 'runUnstepped'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
  /** Whether the project is in Live mode (its mode or its context's environment). */
  readonly isLive: () => boolean
  /** The graph of the method on screen: its nodes are those the refresh must report on. */
  readonly db: Pick<GraphDb, 'nodeIdToNode'>
  /** The root of the module in the editor, whose code is checked for anything that enables output. */
  readonly moduleRoot: () => Ast.Ast | undefined
  /** Only `recompute`, which this tool calls with `'all'` and nothing else. */
  readonly executionContext: Pick<ExecutionContext, 'recompute'>
}

/**
 * `refresh`: asks the engine to compute every node again, in the context's environment (Design).
 * Refused, before anything is queued, in Live mode ({@link LIVE_REFRESH_ERROR}); and, at the run's
 * turn and with nothing called, in Live mode again, and when {@link writeRefusal} refuses the code of
 * the module in the editor, the project's `Main.enso` ({@link WRITE_ON_REFRESH_ERROR}). That covers
 * a node with the GUI's Write prefix anywhere in the module: the prefix is the call
 * `Standard.Base.Runtime.with_enabled_context …`, whose identifier the check matches. It does not
 * cover library code, library functions that enable output themselves, or `foreign` code. The
 * project's other modules are checked by the handler before it calls this (`otherModules.ts`). Answers `{ refreshed: true, settled }`, where `settled` says whether the engine
 * reported a value again for every computed node of the method on screen in time.
 */
export async function refreshTool(deps: RefreshToolDeps): Promise<McpToolResult> {
  if (deps.isLive()) return toolError(LIVE_REFRESH_ERROR)
  const outcome = await deps.session.runUnstepped(
    deps.caller,
    () => {
      // Checked here, at the run's turn: Live may have begun, or code enabling output been added,
      // while the call waited in the queue. The module's code is read live, so it is never behind
      // the node database (which a node's Write prefix would otherwise be read from).
      if (deps.isLive()) return Err(LIVE_REFRESH_ERROR)
      const root = deps.moduleRoot()
      if (root == null) return Err(NO_MODULE_ERROR)
      if (writeRefusal(root) != null) return Err(WRITE_ON_REFRESH_ERROR)
      const ids: string[] = []
      for (const [id, node] of deps.db.nodeIdToNode) {
        // Only the computed nodes report: the engine sends nothing for a function's argument (an
        // input node) or for the bare name an output node returns, so waiting for those would
        // always run out the 20 s.
        if (node.type === 'component') ids.push(id)
      }
      // The one engine call: exactly this argument, no environment and no expression configs.
      deps.executionContext.recompute('all')
      return Ok<readonly string[]>(ids)
    },
    {
      deadline: deps.deadline,
      // A refresh changes no node, so no graph update follows: do not wait for one.
      awaitsGraphUpdate: false,
      affected: (ids) => ({ changed: ids }),
    },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ refreshed: true }, outcome.value)
}
