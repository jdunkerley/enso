/**
 * @file The one check that keeps an agent from turning Write on. The GUI's per-node Write is a code
 * prefix (`util/ast/node.ts`: `Standard.Base.Runtime.with_enabled_context
 * Standard.Base.Runtime.Context.Output "design" <| …`), so code an agent supplies could switch the
 * output context on by itself. Every place an agent's code enters the project or the engine refuses
 * such code: a node statement (`add_nodes`), a node expression (`edit_node`), a function definition
 * (`add_function`), an import line (`add_nodes`) and an evaluated expression
 * (`evaluate_expression`).
 *
 * This keeps the output context off; it is not a sandbox: Enso code can call Java, which can do
 * anything the IDE's process can.
 */
import { Ast } from '@/util/ast'

/**
 * The identifiers through which Enso code can enable an execution context, from
 * `distribution/lib/Standard/Base/0.0.0-dev/src/Runtime.enso`:
 * - `with_enabled_context`: the module function `Runtime.with_enabled_context context action`,
 *   which the per-node Write prefix calls;
 * - `with_enabled`: the method `Context.with_enabled self action`, as in
 *   `Context.Output.with_enabled <| …`.
 *
 * Both call `Context_Helpers.with_context` (`src/Internal/Context_Helpers.enso`), which is in a
 * `private` module that a project cannot import. Disabling a context (`with_disabled_context`,
 * `with_disabled`) is harmless and allowed.
 */
export const OUTPUT_ENABLING_IDENTIFIERS: ReadonlySet<string> = new Set([
  'with_enabled_context',
  'with_enabled',
])

/** The answer to every tool given code that would turn the output context on. */
export const WRITE_REFUSED_ERROR =
  'Only the user can turn Write on. Remove with_enabled_context / with_enabled from the code; the user clicks Write on the node if they want it to run with output.'

/**
 * Whether `ast` contains, anywhere in its tree, an identifier token naming one of
 * {@link OUTPUT_ENABLING_IDENTIFIERS}: plain or qualified, called or not, as a method name after a
 * dot, inside a nested expression, a function body or a text interpolation. Text and comments are
 * not identifiers and do not count.
 */
export function enablesOutput(ast: Ast.Ast): boolean {
  let found = false
  Ast.visitRecursive(ast, (node) => {
    for (const child of node.children()) {
      if (
        Ast.isToken(child) &&
        child.typeName === 'Ident' &&
        OUTPUT_ENABLING_IDENTIFIERS.has(child.code())
      ) {
        found = true
      }
    }
    return !found
  })
  return found
}
