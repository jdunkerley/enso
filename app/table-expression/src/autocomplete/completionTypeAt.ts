import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { parseNode } from './syntax'
import type { CompletionType } from './types'

const INITIAL_COMPLETION_TYPE: CompletionType = {
  type: 'value',
}

/** Returns information about the completion at the given position. */
export function completionTypeAt(pos: number, state: EditorState): CompletionType | null {
  const doc = state.doc
  if (doc.length === 0) return INITIAL_COMPLETION_TYPE
  // `syntaxTree` returns only as much of the document as has been parsed so far, and CodeMirror
  // parses against a time budget (20ms when a state is created or updated). When the thread is
  // busy, the tree can stop short of `pos` and the lookup below finds nothing; that is how
  // `a_function(1, 2, 3|)` was once reported as a binop. Expressions here are one short line, so
  // finish the parse rather than answer from part of it.
  const tree = ensureSyntaxTree(state, doc.length, Infinity) ?? syntaxTree(state)
  const cursor = tree.cursorAt(pos, 1)
  if (LEAFS_IGNORED_TO_RIGHT_OF_CURSOR.includes(cursor.name)) cursor.parent()
  let node = parseNode(cursor)
  if (node == null) {
    if (cursor.moveTo(pos, -1)) {
      if (LEAFS_IGNORED_TO_LEFT_OF_CURSOR.includes(cursor.name)) cursor.parent()
      node = parseNode(cursor)
      if (node == null) {
        // `cursorAt`/`moveTo` never enter zero-length nodes, regardless of the `side` parameter.
        // Use `next` navigation to check if we are at a zero-length error node.
        if (cursor.next()) {
          if (cursor.from === pos && cursor.from === cursor.to && cursor.name === '⚠') {
            if (cursor.parent()) {
              node = parseNode(cursor)
            }
          }
        }
      }
    }
    if (node == null) {
      if (pos > 0) {
        const sBefore = pos > 0 && doc.sliceString(pos - 1, pos).startsWith(' ')
        const sAfter = doc.sliceString(pos, pos + 1).startsWith(' ')
        return { type: 'binop', pos, auto: sBefore, insertDelim: sBefore && !sAfter }
      }
      return null
    }
  }
  if (node.type === 'Function') {
    const { name, open } = node
    return pos <= name.to ?
        { type: 'functionName', pos: name.from, auto: pos === name.to, insertDelim: open == null }
      : { type: 'functionInfo', pos: name.from, functionName: doc.sliceString(name.from, name.to) }
  } else if (node.type === 'Column') {
    const { name, close } = node
    return {
      type: 'columnName',
      pos: name.from,
      auto: pos === name.to,
      insertDelim: close == null,
    }
  } else if (node.type === 'BinOp') {
    const { lhs, rhs } = node
    if (lhs.from === pos && lhs.to === pos) {
      return { type: 'value' }
    } else if (rhs.from === pos && rhs.to === pos) {
      return { type: 'value' }
    } else {
      return null
    }
  } else if (node.type === 'PrefixOp') {
    const { rhs } = node
    if (rhs.from <= pos && pos <= rhs.to) {
      return { type: 'value' }
    } else {
      return null
    }
  } else {
    return null
  }
}

const LEAFS_IGNORED_TO_RIGHT_OF_CURSOR = [
  'OpenParen',
  'CloseParen',
  'Number',
  'OpenBracket',
  'CloseBracket',
  'ArithOp',
]
const LEAFS_IGNORED_TO_LEFT_OF_CURSOR = ['OpenParen', 'ArithOp']
