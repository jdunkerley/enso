/** @file Code that turns the output context on, and code that only looks like it, for the tests. */

/** The GUI's per-node Write prefix (`util/ast/node.ts`), with the design environment filled in. */
export const WRITE_PREFIX =
  'Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output "design" <| '

/** Expressions that turn the output context on, in every form an entry point must refuse. */
export const ENABLING_EXPRESSIONS = [
  // The GUI's own Write prefix, fully qualified.
  `${WRITE_PREFIX}"x".write "C:/temp/x.txt"`,
  // Plain, after an import of the module.
  'with_enabled_context Context.Output <| "x".write "x.txt"',
  // Qualified through the module.
  'Runtime.with_enabled_context Runtime.Context.Output ("x".write "x.txt")',
  // The method on the context.
  'Context.Output.with_enabled <| "x".write "x.txt"',
  // The method through a name.
  'ctx.with_enabled ("x".write "x.txt")',
  // Inside a nested expression.
  '[1, (Runtime.with_enabled_context Context.Output (2)), 3]',
  // As an argument, without being called.
  'f with_enabled_context',
  // In a lambda.
  'x -> Context.Output.with_enabled x',
  // In an operator section.
  '(.with_enabled)',
  // Inside text interpolation.
  "'a `Context.Output.with_enabled 1` b'",
] as const

/** A function whose body turns the output context on. */
export const ENABLING_FUNCTION =
  'helper x =\n    y = x + 1\n    Runtime.with_enabled_context Runtime.Context.Output <|\n        y.to_text.write "x.txt"'

/** Import lines that bring the enabling function in under its own name or another. */
export const ENABLING_IMPORTS = [
  'from Standard.Base.Runtime import with_enabled_context',
  'from Standard.Base.Runtime import with_enabled_context as w',
] as const

/**
 * Expressions that build a method name from text with `Meta.meta` of an unresolved symbol and
 * `rename`, so that no enabling identifier is written (review Hole A: the first one wrote its file
 * in the packaged app).
 */
export const REFLECTION_EXPRESSIONS = [
  '(Meta.meta .x).rename ("with_" + "enabled") . value Standard.Base.Runtime.Context.Output ("x".write "x.txt")',
  '(Meta.meta .x).rename "with_enabled" . value Context.Output ("x".write "x.txt")',
  '(Standard.Base.Meta.meta .x).rename ("with_" + "enabled")',
  // After `from Standard.Base.Meta import meta`.
  '(meta .x).rename ("with_" + "enabled")',
] as const

/**
 * Hole A in two statements: the renamed symbol bound to a name, then applied. The first statement
 * is refused.
 */
export const REFLECTION_TWO_STATEMENTS = [
  'sym = (Meta.meta .x).rename ("with_" + "enabled")',
  'r = sym.value Standard.Base.Runtime.Context.Output ("x".write "x.txt")',
] as const

/** The import that brings `Meta.meta` in under a plain name. */
export const REFLECTION_IMPORT = 'from Standard.Base.Meta import meta'

/**
 * A function bound to the runtime's builtin that enables a context (review Hole B: a node calling
 * `Main.go Standard.Base.Runtime.Context.Output True ("x".write p)` wrote its file in the packaged
 * app).
 */
export const BUILTIN_FUNCTION = 'go c e ~a = @Builtin_Method "Runtime.with_context_builtin"'

/** Node statements and expressions that contain a `@Builtin_Method` annotation. */
export const BUILTIN_STATEMENTS = [
  'go = @Builtin_Method "Runtime.with_context_builtin"',
  '@Builtin_Method "Runtime.with_context_builtin"',
] as const

/** Code for `Debug.eval` that switches Write on and writes `x.txt`, with no refused name in it. */
const EVAL_SOURCE =
  '("Standard.Base.Runtime.with_" + "enabled_context Standard.Base.Runtime.Context.Output <| \'x\'.write \'x.txt\'")'

/**
 * Expressions that evaluate Text as Enso code with `Debug.eval` (the third route review found: the
 * first one wrote its file in the packaged app, through `evaluate_expression` and `add_nodes`).
 */
export const EVAL_EXPRESSIONS = [
  `Standard.Base.Runtime.Debug.eval ${EVAL_SOURCE}`,
  `Debug.eval ${EVAL_SOURCE}`,
  // The enabling names in plain text: Text is not code to the guard.
  `Runtime.Debug.eval "Standard.Base.Runtime.Context.Output.with_enabled <| 'x'.write 'x.txt'"`,
  // After `from Standard.Base.Runtime.Debug import eval`.
  `eval ${EVAL_SOURCE}`,
] as const

/** `Debug.eval` bound to a name, then applied. The first statement is refused. */
export const EVAL_TWO_STATEMENTS = [
  'e = Standard.Base.Runtime.Debug.eval',
  `r = e ${EVAL_SOURCE}`,
] as const

/** The import that brings `Debug.eval` in under a plain name. */
export const EVAL_IMPORT = 'from Standard.Base.Runtime.Debug import eval'

/**
 * Expressions that look a method up by a Text name through polyglot interop, which Enso values
 * answer: the first wrote its file in the packaged app (`Polyglot.get_member` gives the method with
 * `self` applied, and calling it keeps the action lazy).
 */
export const NAME_LOOKUP_EXPRESSIONS = [
  '(Polyglot.get_member Standard.Base.Runtime.Context.Output ("with_" + "enabled")) ("x".write "x.txt")',
  'Polyglot.invoke Standard.Base.Runtime.Context.Output ("with_" + "enabled") ["x"]',
] as const

/** Expressions that mention similar names but do not turn the output context on. */
export const HARMLESS_EXPRESSIONS = [
  'with_disabled_context Context.Output <| "x".write "x.txt"',
  'Runtime.with_disabled_context Runtime.Context.Output ("x".write "x.txt")',
  'Context.Output.with_disabled <| 1',
  'enabled + 1',
  'with_enabled_foo + enabled_context',
  'Context.Output.is_enabled',
  '"with_enabled_context"',
  // Type inspection through `Meta` stays allowed; only `Meta.meta` is refused.
  'Meta.type_of 1',
  'Meta.is_a 1 Integer',
  // A Text that mentions the annotation is not one.
  '"@Builtin_Method"',
  // A Text with the word eval, and identifiers that only contain it: whole identifiers count.
  '"eval this: Debug.eval"',
  'evaluate_total + retrieval',
  'Polyglot.get_members 1',
] as const
