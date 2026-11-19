/** @file The Enso expressions the tree visualization evaluates, and those it creates nodes from. */
import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { moduleCall } from '@/util/moduleCall'
import { chainPattern } from '../vizActions'
import type { TreeKey } from './treeWire'

/** The module of the tree's Enso entry points. */
export const TREE_MODULE = 'Standard.Visualization.Tree'

/**
 * The expression asking for one page of the children of the branch at `path`, to apply to a
 * node: `Standard.Base.Meta.call_module_method 'Standard.Visualization.Tree' 'children' [[…], start,
 * count] _ <| node`. It goes to `config.executeExpression`, as the table view's server-side rows do.
 */
export function childrenExpression(path: readonly TreeKey[], start: number, count: number) {
  const module = Ast.MutableModule.Transient()
  const keys = path.map((key) =>
    typeof key === 'number' ? Ast.tryNumberToEnso(key, module)! : Ast.TextLiteral.new(key, module),
  )
  const call = moduleCall(module, TREE_MODULE, 'children', [
    Ast.Vector.new(module, keys),
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
  if (chain.length === 0 || !chain.every(isNodeExpression)) return undefined
  return chainPattern(chain.map((step) => ({ code: step.slice(1) })))
}
