/**
 * The bare module names a run-time compiled visualization (a project's or a library's `.vue` file)
 * may import. `compilerMessaging.ts` provides one module per name; the compiler rewrites an import of
 * any of them to read that module. Widening this list widens what every library can rely on: it is
 * the owner's decision (see `CLAUDE.md`, "What a library visualization can use").
 */
export const BUILTIN_MODULE_NAMES = ['vue', 'builtins', 'd3'] as const

/** One of {@link BUILTIN_MODULE_NAMES}. */
export type BuiltinModuleName = (typeof BUILTIN_MODULE_NAMES)[number]
