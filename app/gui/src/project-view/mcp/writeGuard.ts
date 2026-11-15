/**
 * @file The one check that keeps an agent from turning Write on. The GUI's per-node Write is a code
 * prefix (`util/ast/node.ts`: `Standard.Base.Runtime.with_enabled_context
 * Standard.Base.Runtime.Context.Output "design" <| …`), so code an agent supplies could switch the
 * output context on by itself. Every place an agent's code enters the project or the engine refuses
 * such code: a node statement (`add_nodes`), a node expression (`edit_node`), a function definition
 * (`add_function`), an import line (`add_nodes`) and an evaluated expression
 * (`evaluate_expression`).
 *
 * The check is a list of names matched over the parsed code. It stops an agent turning Write on by
 * accident or by following an instruction naively; it is not a security boundary. Deliberately
 * obfuscated code (dynamic dispatch, Java interop) can still reach the output context, and only
 * engine-side enforcement could guarantee otherwise.
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

/**
 * The identifiers through which Enso code can build a method name from text, so that the enabling
 * names never appear in it: `(Meta.meta .x).rename ("with_" + "enabled") . value Context.Output …`
 * calls `Context.Output.with_enabled` (`src/Meta.enso`).
 * - `meta`: `Meta.meta`. Of an unresolved symbol (`.x`) it gives a `Meta.Unresolved`, whose
 *   `rename` makes a symbol with any Text as its name; its `Symbol` constructor is private, so
 *   `Meta.meta` is the only way to get one. Refusing `meta` closes that route.
 *
 * `rename` itself is not refused: `Column.rename` and others share the name, and without
 * `Meta.meta` there is no `Unresolved` to rename. The rest of `Meta` (`Meta.type_of`, `Meta.is_a`,
 * …) only inspects values and stays allowed.
 */
export const REFLECTION_IDENTIFIERS: ReadonlySet<string> = new Set(['meta'])

/**
 * The identifiers through which Enso code can evaluate Text as Enso code, so that the enabling
 * names appear only inside a Text (`Debug.eval ("…with_" + "enabled_context … <| …")`):
 * - `eval`: `Debug.eval expression:Text = @Builtin_Method "Debug.eval"`
 *   (`distribution/lib/Standard/Base/0.0.0-dev/src/Runtime/Debug.enso:45`), which evaluates the
 *   Text in the caller's frame. It is the only public function in `Standard.Base` that compiles
 *   Text as Enso code.
 *
 * `Debug.breakpoint` (`Runtime/Debug.enso:22`) is allowed: it opens the engine's debugger REPL,
 * which reads from the user's terminal, not from the code.
 */
export const EVAL_IDENTIFIERS: ReadonlySet<string> = new Set(['eval'])

/**
 * The identifiers through which Enso code can look a method up by a Text name through polyglot
 * interop, which Enso values answer (`Atom.java` and `Type.java` in `engine/runtime` export
 * `readMember` and `invokeMember` for their methods), from
 * `distribution/lib/Standard/Base/0.0.0-dev/src/Polyglot.enso`:
 * - `get_member`: `Polyglot.get_member object member_name:Text` (`:68`). Of `Context.Output` and
 *   `"with_" + "enabled"` it gives the method with `self` applied; calling that keeps its action
 *   lazy, so the action runs with output.
 * - `invoke`: `Polyglot.invoke target name:Text arguments` (`:114`), the same lookup, called at
 *   once with the arguments already evaluated.
 *
 * The rest of `Polyglot` (`execute`, `new`, `get_members`, `lookup_class`, …) names no Enso method
 * by Text and stays allowed; Java interop is not covered by this guard at all.
 */
export const NAME_LOOKUP_IDENTIFIERS: ReadonlySet<string> = new Set(['get_member', 'invoke'])

/** The annotation that binds a function to one of the runtime's builtins. */
const BUILTIN_ANNOTATION = 'Builtin_Method'

/** The answer to every tool given code that would turn the output context on. */
export const WRITE_REFUSED_ERROR =
  'Only the user can turn Write on. Remove with_enabled_context / with_enabled from the code; the user clicks Write on the node if they want it to run with output.'

/** The answer to every tool given code that looks a method up by reflection. */
export const REFLECTION_REFUSED_ERROR =
  'Code that looks a method up by reflection (Meta.meta) is refused. Only the user can turn Write on, by clicking it on a node.'

/** The answer to every tool given code that evaluates Text as code. */
export const EVAL_REFUSED_ERROR =
  'Code that evaluates text as code (Debug.eval) is refused. Only the user can turn Write on, by clicking it on a node.'

/** The answer to every tool given code that looks a method up by a name in Text. */
export const NAME_LOOKUP_REFUSED_ERROR =
  'Code that looks a method up by a name in text (Polyglot.get_member, Polyglot.invoke) is refused. Only the user can turn Write on, by clicking it on a node.'

/**
 * The answer to every tool given code that binds a runtime builtin: `f c e ~a = @Builtin_Method
 * "Runtime.with_context_builtin"` would enable a context without any of the names above.
 */
export const BUILTIN_REFUSED_ERROR =
  'Code that binds a runtime builtin (@Builtin_Method) is refused.'

/**
 * Why `ast` is refused, or `undefined` when it is not. Anywhere in its tree (plain or qualified,
 * called or not, as a method name after a dot, inside a nested expression, a function body or a
 * text interpolation):
 * - an identifier token in {@link OUTPUT_ENABLING_IDENTIFIERS} ({@link WRITE_REFUSED_ERROR});
 * - an identifier token in {@link REFLECTION_IDENTIFIERS} ({@link REFLECTION_REFUSED_ERROR});
 * - an identifier token in {@link EVAL_IDENTIFIERS} ({@link EVAL_REFUSED_ERROR});
 * - an identifier token in {@link NAME_LOOKUP_IDENTIFIERS} ({@link NAME_LOOKUP_REFUSED_ERROR});
 * - an `@Builtin_Method` annotation: the parser's annotation operator token followed by that
 *   identifier ({@link BUILTIN_REFUSED_ERROR}).
 *
 * Text and comments are not identifiers and do not count.
 */
export function writeRefusal(ast: Ast.Ast): string | undefined {
  let refusal: string | undefined
  Ast.visitRecursive(ast, (node) => {
    let previous: Ast.Token | undefined
    for (const child of node.children()) {
      if (!Ast.isToken(child)) {
        previous = undefined
        continue
      }
      if (child.typeName === 'Ident') {
        const name = child.code()
        if (OUTPUT_ENABLING_IDENTIFIERS.has(name)) refusal ??= WRITE_REFUSED_ERROR
        else if (REFLECTION_IDENTIFIERS.has(name)) refusal ??= REFLECTION_REFUSED_ERROR
        else if (EVAL_IDENTIFIERS.has(name)) refusal ??= EVAL_REFUSED_ERROR
        else if (NAME_LOOKUP_IDENTIFIERS.has(name)) refusal ??= NAME_LOOKUP_REFUSED_ERROR
        else if (name === BUILTIN_ANNOTATION && previous?.typeName === 'AnnotationOperator') {
          refusal ??= BUILTIN_REFUSED_ERROR
        }
      }
      previous = child
    }
    return refusal == null
  })
  return refusal
}
