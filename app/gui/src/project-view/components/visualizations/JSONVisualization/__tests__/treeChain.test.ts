/** @file The tree's node expressions build the same node text as the hand-joined chain did. */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { describe, expect, test } from 'vitest'
import { isNodeExpression, nodeExpressionPattern } from '../treeExpression'

/** What `nodeExpressionPattern` was before the shared builder: the chain joined as a string. */
function referencePattern(chain: readonly string[]): Pattern | undefined {
  const [first, ...rest] = chain
  if (first == null || !chain.every(isNodeExpression)) return undefined
  const code = '__' + first + rest.map((step) => ' . ' + step.slice(1)).join('')
  try {
    return Pattern.parseExpression(code)
  } catch {
    return undefined
  }
}

function nodeText(pattern: Pattern | undefined, source = 'data') {
  return pattern?.instantiateCopied([Ast.parseExpression(source)!]).code()
}

const CHAINS: readonly (readonly string[])[] = [
  [".get 'tags'"],
  [".get 'tags'", '.at 1'],
  ['.rows', '.at 0', ".at 'x'"],
  ['.row_count'],
  [".at '@id'"],
  // Steps that hold `__`, the builder's hole: in a key, in a method name, as the whole key.
  [".get 'a__b'"],
  [".get '__'"],
  [".get '__'", '.at 1', ".get '__'"],
  [".at 'x__'"],
  ['.foo__bar'],
  ['.__init__'],
  ['.__x'],
  ['.x__'],
  // Text keys the tree writes with escapes, and quotes of either kind.
  [String.raw`.get 'it\'s__'`],
  [String.raw`.get 'a\\b__'`],
  [".get 'two words'", '.at -1'],
  ['.at 0'],
  ['.at 1.5'],
  // Steps the old code refused.
  [],
  ['at 3'],
  ['.at ('],
  ['. at 3'],
  [''],
  [".get 'tags'", 'at 1'],
  ['.get "a__b"'],
  [".at 'a__b__c'", '.at 2'],
]

describe('nodeExpressionPattern keeps develop’s node text', () => {
  test.each(CHAINS.map((chain) => [JSON.stringify(chain), chain] as const))('%s', (_, chain) => {
    expect(nodeText(nodeExpressionPattern(chain))).toBe(nodeText(referencePattern(chain)))
  })

  test.each(CHAINS.map((chain) => [JSON.stringify(chain), chain] as const))(
    '%s applied to a call as the source',
    (_, chain) => {
      const source = 'Table.new [[1]]'
      expect(nodeText(nodeExpressionPattern(chain), source)).toBe(
        nodeText(referencePattern(chain), source),
      )
    },
  )

  test('a key holding `__` is written as the key', () => {
    expect(nodeText(nodeExpressionPattern([".get 'a__b'", '.at 1']))).toBe("data.get 'a__b' . at 1")
    expect(nodeText(nodeExpressionPattern(['.__init__']))).toBe('data.__init__')
  })

  // Enso never writes this (`Viz_Tree` quotes every key with `pretty`), so no tree reaches it. The
  // reference pattern has a second hole and throws when it is instantiated with the one node.
  test('a bare `__` step is no node rather than a pattern that throws', () => {
    expect(() => nodeText(referencePattern(['.get __']))).toThrow()
    expect(nodeExpressionPattern(['.get __'])).toBeUndefined()
  })
})
