/**
 * @file The MCP documentation tools: `get_documentation` and `set_documentation`. The
 * documentation is the Markdown the documentation panel shows for the function on screen
 * (`OpenedProjectDocumentationEditor.vue`: `FunctionDef.mutableDocumentationMarkdown()`), the
 * workflow's at the top level and a user-defined function's after `open_method`. Pure functions
 * over {@link DocumentationToolDeps}. `set_documentation` replaces the whole text in one module
 * edit through the edit session, as `set_node_comment` writes a comment.
 */
import { Ast } from '@/util/ast'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import type { EditSession } from './editSession'
import { checkAtTurn, errorResult, methodOnScreen, settledResult, toolError } from './editTools'
import { jsonResult, type GraphToolDeps } from './graphTools'
import { NO_METHOD_ERROR } from './viewTools'

/** Most characters of the documentation in a `get_documentation` result. */
export const DOCUMENTATION_CHARS = 50_000

/** What `get_documentation` reads: the method on screen. */
export type DocumentationToolDeps = Pick<GraphToolDeps, 'db' | 'currentMethod'>

/** What `set_documentation` reads and does. */
export interface SetDocumentationDeps extends DocumentationToolDeps {
  readonly session: Pick<EditSession, 'run'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
  /** Runs `f` in one edit of the module (`module.edit`), committed when it returns Ok. */
  readonly editModule: <T>(f: (edit: Ast.MutableModule) => Result<T>) => Result<T>
}

/** The method on screen: its name and definition; `null` when the editor shows none. */
function methodShown(deps: DocumentationToolDeps): { name: string; ast: Ast.FunctionDef } | null {
  const { ast, pointer } = deps.currentMethod
  return ast.ok && pointer.ok ? { name: pointer.value.name, ast: ast.value } : null
}

function markdownOf(ast: Ast.FunctionDef): string {
  return ast.mutableDocumentationMarkdown().toJSON()
}

/**
 * `get_documentation`: answers `{ method, text, truncated }`, the Markdown documentation of the
 * method on screen, at most {@link DOCUMENTATION_CHARS} characters (the start of it, with
 * `truncated: true`, when longer). Changes nothing, so it works in Live mode.
 */
export async function getDocumentation(deps: DocumentationToolDeps): Promise<McpToolResult> {
  const method = methodShown(deps)
  if (method == null) return toolError(NO_METHOD_ERROR)
  const text = markdownOf(method.ast)
  const truncated = text.length > DOCUMENTATION_CHARS
  return jsonResult({
    method: method.name,
    text: truncated ? text.slice(0, DOCUMENTATION_CHARS) : text,
    truncated,
  })
}

/**
 * `set_documentation`: replaces the whole Markdown documentation of the method on screen with
 * `text` (`""` clears it) in one module edit through the edit session, so it is refused in Live
 * mode and when the method on screen changed before the edit's turn, and joins the caller's undo
 * step. Answers `{ method, characters, settled: true }`: documentation changes nothing the engine
 * runs. A text equal to the documentation as it is at the edit's turn (after any edit queued
 * before it) makes no module edit and adds `unchanged: true`; in Live mode it is refused all the
 * same.
 */
export async function setDocumentation(
  deps: SetDocumentationDeps,
  { text }: { text: string },
): Promise<McpToolResult> {
  const shown = methodShown(deps)
  if (shown == null) return toolError(NO_METHOD_ERROR)
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    // Documentation changes nothing the engine runs: no expression is affected, so it settles at
    // once.
    (): Result<{ unchanged: boolean }> => {
      const sameMethod = checkAtTurn(deps, method)
      if (!sameMethod.ok) return sameMethod
      // Read again at the turn: the method's definition may be a newer version by now, and an
      // edit queued before this one may have changed the text.
      const ast = deps.currentMethod.ast
      if (!ast.ok) return Err(NO_METHOD_ERROR)
      if (markdownOf(ast.value) === text) return Ok({ unchanged: true })
      const edited = deps.editModule((edit) => {
        const markdown = edit.getVersion(ast.value).mutableDocumentationMarkdown()
        markdown.delete(0, markdown.length)
        if (text !== '') markdown.insert(0, text)
        return Ok()
      })
      return edited.ok ? Ok({ unchanged: false }) : edited
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult(
    {
      method: shown.name,
      characters: text.length,
      ...(outcome.value.value.unchanged ? { unchanged: true } : {}),
    },
    outcome.value,
  )
}
