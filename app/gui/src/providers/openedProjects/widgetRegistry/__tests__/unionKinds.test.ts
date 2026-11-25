import { expect, test } from 'vitest'
import {
  composeUnion,
  kindLabel,
  NOTHING_TYPE,
  unionMembers,
  type Converts,
  type MemberWidget,
} from '../unionKinds'

const TEXT = 'Standard.Base.Data.Text.Text'
const INTEGER = 'Standard.Base.Data.Numbers.Integer'
const FLOAT = 'Standard.Base.Data.Numbers.Float'
const FILE = 'Standard.Base.System.File.File'
const WRITABLE = 'Standard.Base.System.File.Writable_File.Writable_File'
const URI = 'Standard.Base.Network.URI.URI'
const SECRET = 'Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret'
const DERIVED = 'Standard.Base.Enso_Cloud.Enso_Secret.Derived_Secret_Value'
const REGEX = 'Standard.Base.Data.Text.Regex.Regex'
const LOCALE = 'Standard.Base.Data.Locale.Locale'
const CASE = 'Standard.Base.Data.Text.Case.Case'
const ROWS = 'Standard.Table.Rows_To_Read.Rows_To_Read'

/** Conversions as in the standard library: target ← sources. */
const CONVERSIONS: Record<string, string[]> = {
  [FILE]: [TEXT],
  [WRITABLE]: [TEXT, FILE],
  [URI]: [TEXT],
  [FLOAT]: [INTEGER],
  [DERIVED]: [TEXT, SECRET],
  [ROWS]: [INTEGER, NOTHING_TYPE],
}
const converts: Converts = (source, target) => CONVERSIONS[target]?.includes(source) ?? false
const none: Converts = () => false

const textInput = { kind: 'Text_Input' } as const
const numeric = { kind: 'Numeric_Input' } as const
const regex = { kind: 'Regex_Input' } as const
const secret = { kind: 'Secret_Browse' } as const
/* eslint-disable camelcase */
const file = { kind: 'File_Browse', existing_only: true, file_types: [] } as const
const save = { kind: 'File_Browse', existing_only: false, file_types: [] } as const
/* eslint-enable camelcase */
const choice = (v: string) => ({ value: v, label: v, parameters: [] })
const locales = { kind: 'Single_Choice', values: [choice('..Default')] } as const
const cases = { kind: 'Single_Choice', values: [choice('..Upper'), choice('..Lower')] } as const
const rows = { kind: 'Single_Choice', values: [choice('..All_Rows')] } as const
const m = (typeName: string, config: MemberWidget['config']): MemberWidget => ({ typeName, config })
const nothing = m(NOTHING_TYPE, undefined)

test.each([
  [TEXT, [TEXT]],
  [`${TEXT} | ${INTEGER} | ${NOTHING_TYPE}`, [TEXT, INTEGER, NOTHING_TYPE]],
  [`(${TEXT} | ${FILE})`, [TEXT, FILE]],
  [
    'Standard.Base.Data.Vector.Vector Standard.Network.HTTP.Header.Header | (Standard.Base.Data.Pair.Pair Standard.Base.Data.Text.Text Standard.Base.Data.Text.Text)',
    [
      'Standard.Base.Data.Vector.Vector Standard.Network.HTTP.Header.Header',
      'Standard.Base.Data.Pair.Pair Standard.Base.Data.Text.Text Standard.Base.Data.Text.Text',
    ],
  ],
])('unionMembers(%s)', (repr, expected) => {
  expect(unionMembers(repr)).toEqual(expected)
})

test('kindLabel', () => {
  expect(kindLabel(TEXT)).toBe('Text')
  expect(kindLabel(NOTHING_TYPE)).toBe('Nothing')
  expect(kindLabel('Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text')).toBe(
    'Vector Text',
  )
  expect(kindLabel('(Standard.Base.Data.Text.Text)')).toBe('Text')
})

test('Text | Integer | Nothing is a Union with Nothing last', () => {
  expect(composeUnion([m(TEXT, textInput), m(INTEGER, numeric), nothing], converts)).toEqual({
    kind: 'Union',
    kinds: [
      { label: 'Text', config: textInput },
      { label: 'Integer', config: numeric },
      { label: 'Nothing', config: null },
    ],
  })
})

test('Integer | Nothing is a Union of two kinds (Nothing counts)', () => {
  expect(composeUnion([m(INTEGER, numeric), nothing], converts)).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Integer' }, { label: 'Nothing' }],
  })
})

test('a member without a widget is not a kind', () => {
  expect(composeUnion([m(URI, undefined), m(TEXT, textInput)], none)).toEqual(textInput)
})

// The conversion rule (owner decision 3).
test('File absorbs Text: Text | URI | File is the file browser alone (Data.read)', () => {
  expect(composeUnion([m(TEXT, textInput), m(URI, undefined), m(FILE, file)], converts)).toEqual(
    file,
  )
})

test('Text | File | Nothing is File and Nothing', () => {
  expect(composeUnion([m(TEXT, textInput), m(FILE, file), nothing], converts)).toMatchObject({
    kind: 'Union',
    kinds: [
      { label: 'File', config: file },
      { label: 'Nothing', config: null },
    ],
  })
})

test('absorption chains: Text | File | Writable_File is Writable_File alone', () => {
  expect(composeUnion([m(TEXT, textInput), m(FILE, file), m(WRITABLE, save)], converts)).toEqual(
    save,
  )
})

test('a member without a widget absorbs nothing: URI does not take Text', () => {
  expect(composeUnion([m(TEXT, textInput), m(URI, undefined)], converts)).toEqual(textInput)
})

test('Text | Enso_Secret keeps both kinds (no Enso_Secret.from Text)', () => {
  expect(composeUnion([m(TEXT, textInput), m(SECRET, secret)], converts)).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Text' }, { label: 'Enso_Secret' }],
  })
})

test("Header's Text | Enso_Secret | Derived_Secret_Value keeps Text and Secret while Derived_Secret_Value has no widget", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(SECRET, secret), m(DERIVED, undefined)], converts),
  ).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Text' }, { label: 'Enso_Secret' }],
  })
})

test('Text | Regex keeps both kinds', () => {
  expect(composeUnion([m(TEXT, textInput), m(REGEX, regex)], converts)).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Text' }, { label: 'Regex' }],
  })
})

test('Float absorbs Integer', () => {
  expect(composeUnion([m(INTEGER, numeric), m(FLOAT, numeric), nothing], converts)).toMatchObject({
    kind: 'Union',
    kinds: [{ label: 'Float' }, { label: 'Nothing' }],
  })
})

test('Nothing is never absorbed', () => {
  expect(composeUnion([m(ROWS, rows), nothing], converts)).toEqual({
    kind: 'Single_Choice',
    values: [choice('..All_Rows'), { value: 'Nothing', label: 'Nothing', parameters: [] }],
  })
})

test('mutual conversions keep the earlier member', () => {
  const both: Converts = () => true
  expect(composeUnion([m(TEXT, textInput), m(REGEX, regex)], both)).toEqual(textInput)
})

/** Conversions along `order`, each member to the next, the last back to the first. */
const cycle =
  (...order: string[]): Converts =>
  (source, target) =>
    order.includes(source) && order.indexOf(target) === (order.indexOf(source) + 1) % order.length

const A = 'My.A'
const B = 'My.B'
const C = 'My.C'
const D = 'My.D'
const kindsOf = (config: ReturnType<typeof composeUnion>) =>
  config != null && config !== 'pending' && config.kind === 'Union' ?
    config.kinds.map((kind) => kind.label)
  : config

test.each([
  ['A → B → C → A', [A, B, C], cycle(A, B, C)],
  ['A → C → B → A', [A, B, C], cycle(A, C, B)],
  ['A → B → C → D → A', [A, B, C, D], cycle(A, B, C, D)],
])('a cycle of three or more (%s) keeps its earliest member alone', (_, order, conversions) => {
  const members = order.map((type, i) => m(type, { kind: 'Numeric_Input', minimum: i }))
  expect(composeUnion(members, conversions)).toEqual(members[0]!.config)
  // Listed in another order, the earliest listed stays.
  expect(composeUnion([...members].reverse(), conversions)).toEqual(members.at(-1)!.config)
})

test('a cycle beside an unrelated member keeps its earliest member and the other', () => {
  const members = [A, B, C, D].map((type, i) => m(type, { kind: 'Numeric_Input', minimum: i }))
  expect(kindsOf(composeUnion(members, cycle(A, B, C)))).toEqual(['A', 'D'])
  expect(kindsOf(composeUnion([...members, nothing], cycle(B, C, D)))).toEqual([
    'A',
    'B',
    'Nothing',
  ])
})

test('a cycle converting on to a member outside it is absorbed by that member', () => {
  const members = [A, B, C, D].map((type, i) => m(type, { kind: 'Numeric_Input', minimum: i }))
  const conversions: Converts = (source, target) =>
    cycle(A, B, C)(source, target) || (source === C && target === D)
  expect(composeUnion(members, conversions)).toEqual(members[3]!.config)
})

test('equal widgets collapse into the first member', () => {
  expect(composeUnion([m(INTEGER, numeric), m(FLOAT, numeric)], none)).toEqual(numeric)
})

test('dropdowns merge into one dropdown, Nothing an option', () => {
  expect(composeUnion([m(LOCALE, locales), m(CASE, cases), nothing], converts)).toEqual({
    kind: 'Single_Choice',
    values: [
      choice('..Default'),
      choice('..Upper'),
      choice('..Lower'),
      { value: 'Nothing', label: 'Nothing', parameters: [] },
    ],
  })
})

test('Locale | Nothing is the Locale dropdown with a Nothing option', () => {
  expect(composeUnion([m(LOCALE, locales), nothing], converts)).toEqual({
    kind: 'Single_Choice',
    values: [choice('..Default'), { value: 'Nothing', label: 'Nothing', parameters: [] }],
  })
})

test('merged dropdowns drop repeated values', () => {
  expect(composeUnion([m(LOCALE, locales), m(LOCALE + '2', locales)], converts)).toEqual(locales)
})

test('pending while any member is pending', () => {
  expect(composeUnion([m(TEXT, textInput), m(INTEGER, 'pending')], converts)).toBe('pending')
})

test('Nothing alone has no widget', () => {
  expect(composeUnion([nothing], converts)).toBeUndefined()
})

test('unionMembers splits only at the top level', () => {
  expect(unionMembers('A | (B | C)')).toEqual(['A', 'B | C'])
})
