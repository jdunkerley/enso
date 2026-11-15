/**
 * @file The nodes the table's right-click menu creates: Get Column, Get Row and Get Value.
 * Snapshotted by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'

export type ValueNodeAction = 'at' | 'get_row' | 'get_value'

function getAstValuePattern(value?: string | number, action?: string) {
  if (action && value != null) {
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier(action)!),
        typeof value === 'number' ?
          Ast.tryNumberToEnso(value, ast.module)!
        : Ast.TextLiteral.new(value, ast.module),
      ),
    )
  }
}

function getAstGetValuePattern(columnId?: string, rowIndex?: number, action?: string) {
  if (action && columnId && rowIndex != undefined) {
    const pattern = Pattern.parseExpression('__ __')
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier('get_value')!),
        pattern.instantiateCopied([
          Ast.TextLiteral.new(columnId as string, ast.module),
          Ast.tryNumberToEnso(rowIndex as number, ast.module)!,
        ]),
      ),
    )
  }
}

/** The node a menu item creates, or `undefined` when the click lacks what the item needs. */
export function valueNodePattern(
  columnId: string | null | undefined,
  rowIndex: number | null | undefined,
  action: ValueNodeAction,
): Pattern | undefined {
  if (action === 'at' && columnId != null) return getAstValuePattern(columnId, action)
  if (action === 'get_row' && rowIndex != null) return getAstValuePattern(rowIndex, action)
  if (action === 'get_value' && columnId != null && rowIndex != null)
    return getAstGetValuePattern(columnId, rowIndex, action)
  return undefined
}
