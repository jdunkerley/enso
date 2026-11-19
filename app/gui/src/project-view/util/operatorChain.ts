/**
 * @file How an operator chain is drawn in a node (spec:
 * `docs/superpowers/specs/2026-11-19-single-line-nodes-and-operator-chains-design.md`).
 *
 * A run of operators with the same precedence is one flat row (spacing does not change how two
 * operators bind: `a+b * c` is `a + (b * c)`); an operand that is a chain of a
 * different precedence (or one in parentheses) is a capsule.
 */
import { Ast } from '@/util/ast'

/**
 * How an infix application is drawn, relative to the operator application it is an operand of.
 *
 * - `root`: it is not an operand of an operator (the node's expression, a prefix argument).
 * - `continue`: it continues its parent's chain, so its operands sit in the parent's row.
 * - `capsule`: it is a chain of its own inside its parent's, drawn as a tinted capsule.
 */
export type ChainRole = 'root' | 'continue' | 'capsule'

function operatorInfo(app: Ast.OprApp) {
  const opr = app.operator
  return opr.ok ? Ast.binaryOperatorInfo(opr.value.code()) : undefined
}

/** See {@link ChainRole}. */
export function chainRole(app: Ast.OprApp): ChainRole {
  let child: Ast.Ast = app
  let parent = app.parent()
  const parenthesised = parent instanceof Ast.Group
  if (parent instanceof Ast.Group) {
    child = parent
    parent = parent.parent()
  }
  if (!(parent instanceof Ast.OprApp)) return 'root'
  const own = operatorInfo(app)
  const outer = operatorInfo(parent)
  if (own == null || outer == null) return 'root'
  const associatingSide = outer.rightAssociative ? parent.rhs : parent.lhs
  const continues =
    !parenthesised &&
    own.precedence === outer.precedence &&
    own.rightAssociative === outer.rightAssociative &&
    associatingSide?.id === child.id
  return continues ? 'continue' : 'capsule'
}

/** Whether a group's parentheses give way to a capsule: its expression is a capsuled chain. */
export function isCapsuledGroup(group: Ast.Group): boolean {
  const inner = group.expression
  return inner instanceof Ast.OprApp && chainRole(inner) === 'capsule'
}
