/* eslint-disable camelcase */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect, test } from 'vitest'
import { expandColumnPickers, expandPicker, prettyText, SchemaCache } from '../columnPickers'

const cols = {
  names: ['A', 'B C', 'D "E"', 'F.G/H\\I'],
  kinds: ['Numeric', 'Textual', 'Other', 'Date_Only'],
  type_names: ['Integer', 'Char', 'Mixed', 'Date'],
} as const
const opt = (label: string, value: string, parameters: unknown[] = []) => ({
  label,
  value,
  parameters,
})
const base = { kinds: [], from: null } as const
const name = {
  kind: 'Column_Name',
  ...base,
  expression: false,
  reference: false,
  extra: [],
  columns_first: false,
} as const

test("prettyText matches Enso's Text.pretty", () => {
  expect(prettyText('A')).toBe("'A'")
  expect(prettyText('D "E"')).toBe('\'D "E"\'')
  expect(prettyText('F.G/H\\I')).toBe("'F.G/H\\\\I'")
  expect(prettyText("it's")).toBe("'it\\'s'")
})

test('Column_Name: one option per column, values pretty', () => {
  expect(expandPicker(name, cols)).toEqual({
    kind: 'Single_Choice',
    values: [
      opt('A', "'A'"),
      opt('B C', "'B C'"),
      opt('D "E"', '\'D "E"\''),
      opt('F.G/H\\I', "'F.G/H\\\\I'"),
    ],
  })
})

test("Column_Name with an expression option first (filter's column)", () => {
  const result = expandPicker({ ...name, expression: true }, cols)
  expect(result.kind === 'Single_Choice' && result.values[0]).toEqual(
    opt('<Expression>', "(expr '[A]')"),
  )
})

test('kinds filter, Other always offered', () => {
  const result = expandPicker({ ...name, kinds: ['Numeric'] }, cols)
  expect(result.kind === 'Single_Choice' && result.values.map((v) => v.label)).toEqual([
    'A',
    'D "E"',
  ])
})

test('kinds of only Other lists just the Other columns', () => {
  const result = expandPicker({ ...name, kinds: ['Other'] }, cols)
  expect(result.kind === 'Single_Choice' && result.values.map((v) => v.label)).toEqual(['D "E"'])
})

test('reference wraps values as ..Name, extras first unless columns_first', () => {
  const extra = [opt('<Text Value>', "''")]
  const ref = expandPicker(
    { ...name, reference: true, extra },
    { ...cols, names: ['A'], kinds: ['Numeric'], type_names: [''] },
  )
  expect(ref).toEqual({
    kind: 'Single_Choice',
    values: [opt('<Text Value>', "''"), opt('A', "(..Name 'A')")],
  })
  const first = expandPicker(
    { ...name, reference: true, extra, columns_first: true },
    { names: ['A'], kinds: ['Numeric'], type_names: [''] },
  )
  expect(first.kind === 'Single_Choice' && first.values.map((v) => v.label)).toEqual([
    'A',
    '<Text Value>',
  ])
})

test('Column_Names with regex and by-type options', () => {
  expect(
    expandPicker(
      { kind: 'Column_Names', ...base, regex: true, by_type: true },
      { names: ['A'], kinds: ['Numeric'], type_names: [''] },
    ),
  ).toEqual({
    kind: 'Multiple_Choice',
    values: [
      opt('<Regular Expression>', 'regex'),
      opt('<By Type>', '(..By_Type ..Integer)'),
      opt('A', "'A'"),
    ],
  })
})

test('Column_Vector and Order_By', () => {
  const two = {
    names: ['A', 'B'],
    kinds: ['Numeric', 'Numeric'],
    type_names: ['', ''],
  } as const
  expect(expandPicker({ kind: 'Column_Vector', ...base }, two)).toMatchObject({
    kind: 'Vector_Editor',
    item_default: "'A'",
    item_editor: { kind: 'Single_Choice' },
  })
  expect(expandPicker({ kind: 'Order_By', from: null, name_only: false }, two)).toEqual({
    kind: 'Vector_Editor',
    item_default: "(..Name 'A')",
    item_editor: {
      kind: 'Single_Choice',
      values: [
        opt('Name', '..Name', [
          [
            'name',
            {
              kind: 'Single_Choice',
              values: [opt('A', "'A'"), opt('B', "'B'")],
            },
          ],
        ]),
        opt('Index', '..Index', [['index', { kind: 'Numeric_Input', minimum: 0, maximum: 1 }]]),
      ],
    },
  })
})

test('an absent source (owner decision 13)', () => {
  expect(expandPicker(name, undefined)).toEqual({ kind: 'Text_Input' })
  expect(expandPicker({ ...name, extra: [opt('x', '1')] }, undefined)).toEqual({
    kind: 'Single_Choice',
    values: [opt('x', '1')],
  })
  expect(expandPicker({ kind: 'Order_By', from: null, name_only: false }, undefined)).toEqual({
    kind: 'Vector_Editor',
    item_editor: { kind: 'Text_Input' },
    item_default: "''",
  })
})

test('references at any depth, each from its own source', () => {
  const join = {
    kind: 'Vector_Editor',
    item_default: '_',
    item_editor: {
      kind: 'Single_Choice',
      values: [
        opt('Equals', '..Equals', [
          ['left', name],
          ['right', { ...name, from: 'right' }],
        ]),
      ],
    },
  } as const
  const right = { names: ['X'], kinds: ['Numeric'], type_names: [''] } as const
  const expanded = expandColumnPickers(join as never, { '': cols, right })
  const params = (expanded as any).item_editor.values[0].parameters
  expect(params[0][1].values).toHaveLength(4)
  expect(params[1][1]).toEqual({
    kind: 'Single_Choice',
    values: [opt('X', "'X'")],
  })
})

test('the same schema hits the cache; a different one does not', () => {
  const cache = new SchemaCache()
  let computed = 0
  const compute = () => (computed++, { kind: 'Text_Input' }) as const
  cache.get('s1', 'p', compute)
  cache.get('s1', 'p', compute)
  cache.get('s2', 'p', compute)
  expect(computed).toBe(2)
})

test('Column_Names with an absent source and no flags is free text (owner decision 13)', () => {
  expect(
    expandPicker({ kind: 'Column_Names', ...base, regex: false, by_type: false }, undefined),
  ).toEqual({ kind: 'Text_Input' })
})

test('expandColumnPickers returns the identical object for the same schema', () => {
  const cache = new SchemaCache()
  const first = expandColumnPickers(name, { '': cols }, cache)
  const second = expandColumnPickers({ ...name }, { '': { ...cols } }, cache)
  expect(second).toBe(first)
  expect(expandColumnPickers(name, { '': { ...cols, names: ['Z'] } }, cache)).not.toBe(first)
})

test('a picker nested in another picker, naming another source, follows that source', () => {
  const cache = new SchemaCache()
  // The outer picker reads the subject; one of its extras takes a column of `right`.
  const outer = {
    ...name,
    extra: [opt('Other', '..Other', [['column', { ...name, from: 'right' }]])],
  } as const
  const right = (names: string[]) =>
    ({ names, kinds: names.map(() => 'Textual'), type_names: names.map(() => 'Char') }) as const
  const nestedValues = (expanded: unknown) =>
    (expanded as any).values
      .find((choice: { label: string }) => choice.label === 'Other')
      .parameters[0][1].values.map((choice: { label: string }) => choice.label)
  const first = expandColumnPickers(outer as never, { '': cols, right: right(['X']) }, cache)
  expect(nestedValues(first)).toEqual(['X'])
  // Only `right` changes: the subject's schema is the same, but the expansion is not.
  const second = expandColumnPickers(outer as never, { '': cols, right: right(['Y']) }, cache)
  expect(nestedValues(second)).toEqual(['Y'])
  // And back: the first expansion is reused.
  expect(expandColumnPickers(outer as never, { '': cols, right: right(['X']) }, cache)).toBe(first)
})

test("prettyText escapes exactly what Enso's Core_Text_Utils.prettyPrint does", () => {
  // Read the escapes from the Java source, so a change on either side fails here.
  const java = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../../../../../lib/scala/common-polyglot-core-utils/src/main/java/org/enso/polyglot/common_utils/Core_Text_Utils.java',
    ),
    'utf-8',
  )
  const body = java.slice(java.indexOf('String prettyPrint('))
  // The value of a Java char or string literal's text (only the escapes this method uses).
  const JAVA_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0' }
  const unescape = (literal: string) =>
    literal.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, escape: string) =>
      escape.length === 5 ?
        String.fromCharCode(parseInt(escape.slice(1), 16))
      : (JAVA_ESCAPES[escape] ?? escape),
    )
  const cases = [
    ...body.matchAll(
      /case '((?:[^'\\]|\\.|\\u[0-9a-fA-F]{4})+)' -> sb\.append\("((?:[^"\\]|\\.)*)"\);/g,
    ),
  ].map(([, char, escaped]) => [unescape(char!), unescape(escaped!)] as const)
  expect(cases.length).toBe(11)
  for (const [char, escaped] of cases)
    expect(prettyText(char), JSON.stringify(char)).toBe(`'${escaped}'`)
  // Any other control character is written as it is: `default -> sb.append(c)`.
  expect(body).toContain('default -> sb.append(c);')
  expect(prettyText('a\u0001b')).toBe("'a\u0001b'")
  expect(prettyText('\u007f\u0085')).toBe("'\u007f\u0085'")
})

test('the least recently used schema is dropped', () => {
  const cache = new SchemaCache(2)
  let computed = 0
  const compute = () => (computed++, { kind: 'Text_Input' }) as const
  cache.get('s1', 'p', compute)
  cache.get('s2', 'p', compute)
  cache.get('s1', 'p', compute) // s1 is now the most recent
  cache.get('s3', 'p', compute) // drops s2
  expect(computed).toBe(3)
  cache.get('s1', 'p', compute)
  expect(computed).toBe(3)
  cache.get('s2', 'p', compute)
  expect(computed).toBe(4)
})

test('a Union expands a picker among its kinds and keeps Nothing', () => {
  const union = {
    kind: 'Union',
    kinds: [
      { label: 'Name', config: { ...name, from: 'self' } },
      { label: 'Nothing', config: null },
    ],
  } as const
  const result = expandColumnPickers(union as never, { self: cols })
  expect(result).toEqual({
    kind: 'Union',
    kinds: [
      { label: 'Name', config: expandPicker(name, cols) },
      { label: 'Nothing', config: null },
    ],
  })
})

test('a Union without pickers is returned identical', () => {
  const union = {
    kind: 'Union',
    kinds: [
      { label: 'Text', config: { kind: 'Text_Input' } },
      { label: 'Nothing', config: null },
    ],
  } as const
  expect(expandColumnPickers(union as never, { self: cols })).toBe(union)
})
