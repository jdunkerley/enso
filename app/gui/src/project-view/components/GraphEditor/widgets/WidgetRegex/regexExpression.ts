/**
 * @file Reading a regular expression literal: `regex '…'`, `Regex.compile '…'`.
 */
import { Ast } from '@/util/ast'

const REGEX_HEADS = ['regex', 'Regex.compile']
const REGEX_QUALIFIED_SUFFIXES = ['.Regex.regex', '.Regex.Regex.compile']

/** The pattern literal of `regex '…'`, `regex "…"`, `Regex.compile '…'` (qualified heads too), else `undefined`. */
export function regexPattern(value: Ast.Expression | undefined): Ast.TextLiteral | undefined {
  if (!(value instanceof Ast.App)) return undefined
  const argument = value.argument
  if (!(argument instanceof Ast.TextLiteral) || value.function instanceof Ast.App) return undefined
  const head = value.function.code()
  if (REGEX_HEADS.includes(head) || REGEX_QUALIFIED_SUFFIXES.some((s) => head.endsWith(s)))
    return argument
  return undefined
}
