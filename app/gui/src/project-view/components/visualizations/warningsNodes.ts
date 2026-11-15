/** @file The node the Warnings visualisation creates. Snapshotted by `__tests__/vizNodeTextSnapshot.test.ts`. */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'

/** The visualised node with its warnings removed. */
export function removeWarningsPattern() {
  return Pattern.new<Ast.Expression>((ast) =>
    Ast.PropertyAccess.new(ast.module, ast, Ast.identifier('remove_warnings')!),
  )
}
