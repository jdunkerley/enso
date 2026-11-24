import { EditorState } from '@codemirror/state'
import { expect, test, vi } from 'vitest'
import { completionTypeAt } from '..'
import { tableExpression } from '../..'

function completionTypeCase(source: string) {
  const anchor = source.indexOf('|')
  if (anchor === -1) throw new Error('No selection found in test input')
  const secondAnchor = source.indexOf('|', anchor + 1)
  const pos = secondAnchor > 0 ? secondAnchor - 1 : anchor
  const doc = source.replaceAll('|', '')
  const state = EditorState.create({
    doc,
    extensions: tableExpression(),
  })
  return { completion: completionTypeAt(pos, state), anchor }
}

test.each([
  {
    source: '|a_function(1, 2, 3)',
    auto: false,
    insertDelim: false,
  },
  {
    source: '|a_|function(1, 2, 3)',
    auto: false,
    insertDelim: false,
  },
  {
    source: '|a_func|tion(1, 2, 3)',
    auto: false,
    insertDelim: false,
  },
  {
    source: '|a_function|(1, 2, 3)',
    auto: true,
    insertDelim: false,
  },
  {
    source: '|without_parens',
    auto: false,
    insertDelim: true,
  },
  {
    source: '|without|_parens',
    auto: false,
    insertDelim: true,
  },
  {
    source: '|without_parens|',
    auto: true,
    insertDelim: true,
  },
])('Function name completion: $source', ({ source, auto, insertDelim }) => {
  const { completion, anchor } = completionTypeCase(source)
  expect(completion).toStrictEqual({ type: 'functionName', pos: anchor, auto, insertDelim })
})

test.each([
  { source: 'a_function(|1, 2, 3)', argIndex: 0, argValueFrom: undefined },
  { source: 'a_function(1|, 2, 3)', argIndex: 0, argValueFrom: undefined },
  { source: 'a_function(1,| 2, 3)', argIndex: 1, argValueFrom: 13 },
  { source: 'a_function(1, |2, 3)', argIndex: 1, argValueFrom: undefined },
  { source: 'a_function(1, 2, 3|)', argIndex: 2, argValueFrom: undefined },
])('Function info completion: $source', ({ source, argIndex, argValueFrom }) => {
  const { completion } = completionTypeCase(source)
  expect(completion).toStrictEqual({
    type: 'functionInfo',
    pos: 0,
    functionName: 'a_function',
    argIndex,
    argValueFrom,
  })
})

// `|` marks the cursor and `^` where the offered value would start.
test.each([
  { source: 'cast([Value], ^|)', argIndex: 1 },
  { source: 'cast([Value], ^|', argIndex: 1 },
  { source: 'cast([Value],^|)', argIndex: 1 },
  { source: 'cast([Value], ^..|)', argIndex: 1 },
  { source: 'cast([Value], ^..Ch|)', argIndex: 1 },
  { source: 'cast([Value], ^..Ch|', argIndex: 1 },
  { source: 'cast([Value], ^..Ch|ar)', argIndex: 1 },
  { source: 'cast([Value], ^..Char|)', argIndex: 1 },
  { source: 'cast(^|)', argIndex: 0 },
  { source: 'cast([A, B], ^..C|)', argIndex: 1 },
  { source: 'cast([A]], B], ^..C|)', argIndex: 1 },
  { source: "cast(concat([A], ', ('), ^..C|)", argIndex: 1 },
  { source: 'f([A], g(1, 2), ^..C|)', argIndex: 2 },
  { source: 'f([A], g(1, ^..C|))', argIndex: 1, functionName: 'g', pos: 7 },
  { source: '[A] + cast([B], ^..C|)', argIndex: 1, pos: 6 },
])('Argument value completion: $source', ({ source, argIndex, functionName, pos }) => {
  const valueFrom = source.indexOf('^')
  const { completion } = completionTypeCase(source.replace('^', ''))
  expect(completion).toStrictEqual({
    type: 'functionInfo',
    pos: pos ?? 0,
    functionName: functionName ?? (source.startsWith('f') ? 'f' : 'cast'),
    argIndex,
    argValueFrom: valueFrom,
  })
})

test.each([
  { source: '[|Column 1]', auto: false, insertDelim: false },
  { source: '[|Column| 1]', auto: false, insertDelim: false },
  { source: '[|Column 1|]', auto: true, insertDelim: false },
  { source: 'a_function([|Column 1])', auto: false, insertDelim: false },
  { source: 'a_function([|Column| 1])', auto: false, insertDelim: false },
  { source: 'a_function([|Column 1|])', auto: true, insertDelim: false },
  { source: '[|Column 1', auto: false, insertDelim: true },
  { source: '[|Column| 1', auto: false, insertDelim: true },
  { source: '[|Column 1|', auto: true, insertDelim: true },
  { source: 'a_function([|Column 1', auto: false, insertDelim: true },
  { source: 'a_function([|Column| 1', auto: false, insertDelim: true },
  { source: 'a_function([|Column 1|', auto: true, insertDelim: true },
  { source: 'a_function([|Column 1)', auto: false, insertDelim: true },
  { source: 'a_function([|Column| 1)', auto: false, insertDelim: true },
  // NOTE: `auto: false` here because the parser's error recovery treats the close-paren as part of
  // the column name. This is hard to avoid because parens are legal in column names.
  { source: 'a_function([|Column 1|)', auto: false, insertDelim: true },
  // A bit surprising, for the same reason as the previous case.
  { source: 'a_function([|Column 1)|', auto: true, insertDelim: true },
  { source: '[|', auto: true, insertDelim: true },
])('Column completion: $source', ({ source, auto, insertDelim }) => {
  const { completion, anchor } = completionTypeCase(source)
  expect(completion).toStrictEqual({ type: 'columnName', pos: anchor, auto, insertDelim })
})

test.each(['|', '[Column 1] + |', '!|', '! |', '!(|)', '! (|)', 'not |', 'not(|)', 'not (|)'])(
  'Any-value completion: %s',
  (source) => {
    const { completion } = completionTypeCase(source)
    expect(completion).toStrictEqual({ type: 'value' })
  },
)

test.each([
  { source: '[Column 1]|', auto: false, insertDelim: false },
  { source: '[Column 1] |', auto: true, insertDelim: true },
  { source: 'a_function([Column 1])|', auto: false, insertDelim: false },
  { source: 'a_function([Column 1]) |', auto: true, insertDelim: true },
])('Binop completion: $source', ({ source, auto, insertDelim }) => {
  const { completion, anchor: pos } = completionTypeCase(source)
  expect(completion).toStrictEqual({ type: 'binop', pos, auto, insertDelim })
})

// CodeMirror parses a new state against a 20ms time budget, so on a busy thread the initial tree
// can stop partway through the document. Simulate that by making every clock read 25ms later: the
// result must still come from the whole expression, not from the part parsed in time.
test('Completion does not depend on the initial parse finishing within its time budget', () => {
  let now = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 25))
  try {
    const { completion } = completionTypeCase('a_function(1, 2, 3|)')
    expect(completion).toStrictEqual({
      type: 'functionInfo',
      pos: 0,
      functionName: 'a_function',
      argIndex: 2,
      argValueFrom: undefined,
    })
  } finally {
    clock.mockRestore()
  }
})
