import type { CopiedNode } from '@/components/GraphEditor/graphClipboard'
import * as Ast from 'ydoc-shared/ast'

/** A `# → value` line: an example's stated result, shown but never pasted. */
export const RESULT_LINE = /^\s*#\s*→/

/**
 * Vertical distance between the pasted nodes of an example: `DEFAULT_NODE_SIZE.y` (32, in
 * `ComponentBrowser/placement.ts`) plus a gap. Not imported, to keep this module loadable by the
 * docs-site generator.
 */
const NODE_STEP = 56

/** The example's code without its result line(s). */
export function exampleCodeText(code: string): string {
  return code
    .split('\n')
    .filter((line) => !RESULT_LINE.test(line))
    .join('\n')
    .trim()
}

function hasInvalid(ast: Ast.Ast): boolean {
  let invalid = false
  Ast.visitRecursive(ast, (node) => {
    if (node instanceof Ast.Invalid) invalid = true
    return !invalid
  })
  return invalid
}

/**
 * The nodes an example pastes as: each top-level statement one node, an assignment keeping its
 * name, stacked downwards. Undefined when the example does not parse or has no statement, so the
 * panel shows no Copy button for it.
 */
export function exampleToNodes(code: string): CopiedNode[] | undefined {
  const block = Ast.parseBlock(exampleCodeText(code))
  if (hasInvalid(block)) return undefined
  const nodes: CopiedNode[] = []
  for (const statement of block.statements()) {
    const position = { x: 0, y: nodes.length * NODE_STEP }
    if (statement instanceof Ast.Assignment) {
      nodes.push({
        binding: statement.pattern.code(),
        expression: statement.expression.code(),
        metadata: { position },
      })
    } else if (statement instanceof Ast.ExpressionStatement) {
      nodes.push({ expression: statement.expression.code(), metadata: { position } })
    } else {
      return undefined
    }
  }
  return nodes.length ? nodes : undefined
}
