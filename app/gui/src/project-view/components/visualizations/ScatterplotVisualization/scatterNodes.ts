/**
 * @file The nodes the scatter plot creates: a filter to the brushed ranges, and a point's row.
 * Snapshotted by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'

const makeFilterPattern = (
  module: Ast.MutableModule,
  columnName: string,
  min: number,
  max: number,
) => {
  return Pattern.parseExpression('__ (..Between __ __)').instantiateCopied([
    Ast.TextLiteral.new(columnName),
    Ast.tryNumberToEnso(min, module)!,
    Ast.tryNumberToEnso(max, module)!,
  ])
}

/** The node filtering the x column to `minX..maxX` and each series to `minY..maxY`. */
export function brushFilterPattern(
  series: string[],
  xColName: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
) {
  return Pattern.new<Ast.Expression>((ast) =>
    series.reduce<Ast.Owned<Ast.MutableExpression>>(
      (pattern, s) =>
        Ast.OprApp.new(
          ast.module,
          pattern,
          '.',
          Ast.App.positional(
            Ast.Ident.new(ast.module, Ast.identifier('filter')!),
            makeFilterPattern(ast.module, s!, minY, maxY),
          ),
        ),
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier('filter')!),
        makeFilterPattern(ast.module, xColName, minX, maxX),
      ),
    ),
  )
}

/** The node of one point's row: `action` applied to its row number. */
export function rowPattern(selector?: number, action?: string) {
  if (action && selector != null) {
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier(action)!),
        Ast.tryNumberToEnso(selector, ast.module)!,
      ),
    )
  }
}
