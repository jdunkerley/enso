/**
 * @file Finds which argument of a function call the cursor is in, and whether a value could be
 * offered for it there.
 */

/** The argument at the cursor. See {@link argumentAt}. */
export interface ArgumentPosition {
  argIndex: number
  argValueFrom: number | undefined
}

/**
 * Finds the argument at `pos` of a call whose argument list starts at `argsFrom` (just after the
 * opening parenthesis), by counting the commas outside any nested parentheses, column names and
 * texts. Works on text rather than the syntax tree, so that a half-typed argument list still
 * counts.
 */
export function argumentAt(doc: string, argsFrom: number, pos: number): ArgumentPosition {
  let argIndex = 0
  let segmentFrom = argsFrom
  let depth = 0
  let i = argsFrom
  while (i < pos) {
    const c = doc[i]!
    if (c === '[') {
      // A column name runs to the next `]` that is not doubled; `]]` is an escaped bracket.
      i++
      while (i < pos) {
        if (doc[i] === ']') {
          if (doc[i + 1] === ']') i++
          else break
        }
        i++
      }
    } else if (c === '"' || c === "'") {
      // A text runs to its closing quote; a doubled quote is an escaped one, which this treats as
      // closing and reopening.
      i++
      while (i < pos && doc[i] !== c) i++
    } else if (c === '(') {
      depth++
    } else if (c === ')') {
      depth--
    } else if (c === ',' && depth === 0) {
      argIndex++
      segmentFrom = i + 1
    }
    i++
  }
  return { argIndex, argValueFrom: valueFrom(doc, segmentFrom, pos) }
}

function valueFrom(doc: string, segmentFrom: number, pos: number): number | undefined {
  const before = /^\s*(\.|\.\.\w*)?$/.exec(doc.slice(segmentFrom, pos))
  if (before == null) return undefined
  const after = doc[pos]
  const typingName = (before[1]?.length ?? 0) > 0
  const fits = after == null || /[\s,)]/.test(after) || (typingName && /\w/.test(after))
  if (!fits) return undefined
  return pos - (before[1]?.length ?? 0)
}
