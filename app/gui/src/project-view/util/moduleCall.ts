/**
 * @file Expressions the IDE evaluates in a node's frame (in the user's module) that call a
 * library's IDE entry point. A fully qualified name of a library the module does not import does
 * not compile (`FullyQualifiedNames`, "an import statement for it is missing"), so they go through
 * `Standard.Base.Meta.call_module_method`: `Standard.Base` is always compiled, and the library
 * needs only to be loaded.
 */
import { Ast } from '@/util/ast'

export const MODULE_CALL = 'Standard.Base.Meta.call_module_method'

/**
 * `Standard.Base.Meta.call_module_method '<moduleName>' '<methodName>' [<args>] _`: apply it to
 * the value with `<|`, as `F _ <| node` (the method gets the value first, then `args`).
 */
export function moduleCall(
  module: Ast.MutableModule,
  moduleName: string,
  methodName: string,
  args: readonly Ast.Owned<Ast.MutableExpression>[],
): Ast.Owned<Ast.MutableExpression> {
  return Ast.App.PositionalSequence(Ast.parseExpression(MODULE_CALL, module)!, [
    Ast.TextLiteral.new(moduleName, module),
    Ast.TextLiteral.new(methodName, module),
    Ast.Vector.new(module, [...args]),
    Ast.Wildcard.new(module),
  ])
}
