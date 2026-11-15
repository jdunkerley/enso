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

/** Expressions that mention similar names but do not turn the output context on. */
export const HARMLESS_EXPRESSIONS = [
  'with_disabled_context Context.Output <| "x".write "x.txt"',
  'Runtime.with_disabled_context Runtime.Context.Output ("x".write "x.txt")',
  'Context.Output.with_disabled <| 1',
  'enabled + 1',
  'with_enabled_foo + enabled_context',
  'Context.Output.is_enabled',
  '"with_enabled_context"',
] as const
