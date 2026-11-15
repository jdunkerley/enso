/** @file The Enso expressions the tree visualization evaluates, and those it creates nodes from. */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import type { TreeKey } from './treeWire'

/** The module of the tree's Enso entry points. */
export const TREE_MODULE = 'Standard.Visualization.Tree'

/**
 * The expression asking for one page of the children of the branch at `path`, to apply to a
 * node: `Standard.Visualization.Tree.children _ ([…]) start count <| node`. It goes to
 * `config.executeExpression`, as the table view's server-side rows do.
 */
export function childrenExpression(path: readonly TreeKey[], start: number, count: number) {
  const module = Ast.MutableModule.Transient()
  const children = Ast.PropertyAccess.new(
    module,
    Ast.parseExpression(TREE_MODULE, module)!,
    Ast.identifier('children')!,
  )
  const keys = path.map((key) =>
    typeof key === 'number' ? Ast.tryNumberToEnso(key, module)! : Ast.TextLiteral.new(key, module),
  )
  const call = Ast.App.PositionalSequence(children, [
    Ast.Wildcard.new(module),
    Ast.Group.new(module, Ast.Vector.new(module, keys)),
    Ast.tryNumberToEnso(start, module)!,
    Ast.tryNumberToEnso(count, module)!,
  ])
  return (nodeId: string) =>
    Ast.OprApp.new(module, call, '<|', Ast.parseExpression(nodeId, module)!)
}

/** Whether `expr` is a step a node expression can chain: a method call such as `.at 3`. */
export function isNodeExpression(expr: string): boolean {
  return /^\.[A-Za-z_]/.test(expr)
}

/**
 * The node a double-click creates: each step of `chain` applied to the source in turn, joined by
 * the spaced dot so that arguments stay with their method (`__.get 'tags' . at 3`). `undefined`
 * when a step is not a method call or the result does not parse.
 */
export function nodeExpressionPattern(chain: readonly string[]): Pattern | undefined {
  const [first, ...rest] = chain
  if (first == null || !chain.every(isNodeExpression)) return undefined
  const code = '__' + first + rest.map((step) => ' . ' + step.slice(1)).join('')
  try {
    return Pattern.parseExpression(code)
  } catch {
    return undefined
  }
}
