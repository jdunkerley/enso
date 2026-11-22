/* eslint-disable camelcase */
import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import { kindDefaultCode, matchKind } from '../kindMatch'

const text = { label: 'Text', config: { kind: 'Text_Input' } } as const
const integer = { label: 'Integer', config: { kind: 'Numeric_Input' } } as const
const nothing = { label: 'Nothing', config: null } as const
const date = { label: 'Date', config: { kind: 'Date_Input' } } as const
const regex = { label: 'Regex', config: { kind: 'Regex_Input' } } as const
const secret = { label: 'Enso_Secret', config: { kind: 'Secret_Browse' } } as const
const file = { label: 'File', config: { kind: 'File_Browse', file_types: [] } } as const
const kase = {
  label: 'Case',
  config: {
    kind: 'Single_Choice',
    values: [
      { value: '..Upper', label: 'Upper', parameters: [] },
      { value: '..Lower', label: 'Lower', parameters: [] },
    ],
  },
} as const
const bool = { label: 'Boolean', config: { kind: 'Boolean_Input' } } as const
const time = { label: 'Time', config: { kind: 'Time_Input' } } as const
const dateTime = { label: 'Date_Time', config: { kind: 'Date_Time_Input' } } as const
const vector = {
  label: 'Vector',
  config: { kind: 'Vector_Editor', item_editor: { kind: 'Text_Input' }, item_default: "''" },
} as const
const multi = {
  label: 'Multi',
  config: {
    kind: 'Multiple_Choice',
    values: [{ value: '..Upper', label: 'Upper', parameters: [] }],
  },
} as const
const folder = { label: 'Folder', config: { kind: 'Folder_Browse' } } as const
const equals = {
  label: 'Filter',
  config: {
    kind: 'Single_Choice',
    values: [
      { value: '..Equals that=1', label: 'Equals', parameters: [] },
      { value: '(..Plain)', label: 'Plain', parameters: [] },
      { value: '..Foo', label: 'Foo', parameters: [] },
    ],
  },
} as const
const parse = (code: string) => Ast.parseExpression(code)!

test.each([
  ["'hello'", [text, integer, nothing], 0],
  ['42', [text, integer, nothing], 1],
  ['-3', [text, integer, nothing], 1],
  ['Nothing', [text, integer, nothing], 2],
  ['Date.new 2020 1 15', [date, nothing], 0],
  ['Date.today', [date, nothing], 0],
  ['..Lower', [kase, nothing], 0],
  ["'data.csv'", [file, nothing], 0],
  // Text | Regex
  ["'a.*c'", [text, regex], 0],
  ["regex 'a.*c'", [text, regex], 1],
  ['regex "a.*c"', [text, regex], 1],
  ["Regex.compile 'a.*c'", [text, regex], 1],
  ["'a.*c'", [regex, text], 1], // Regex | Text (Text.find): a text literal is still Text
  // Text | Enso_Secret
  ["'my password'", [text, secret], 0],
  ["Enso_Secret.get 'db-password'", [text, secret], 1],
  ["'db-password'", [secret, nothing], undefined], // a bare text is no secret
  ['False', [bool, nothing], 0],
  ['Boolean.True', [bool, nothing], 0],
  ['Time_Of_Day.now', [time, nothing], 0],
  ['Time_Of_Day.new 10 30', [time, nothing], 0],
  ['Date_Time.now', [dateTime, nothing], 0],
  ['[]', [vector, nothing], 0],
  ['[1, 2]', [vector, nothing], 0],
  ['..Equals that=5', [equals, nothing], 0],
  ['..Plain', [equals, nothing], 0],
  ['..Foo x', [equals, nothing], undefined], // an option without arguments is not an application
  ['x', [text, integer, nothing], undefined],
  ['foo 1', [text, integer, nothing], undefined],
] as const)('matchKind(%s)', (code, kinds, expected) => {
  expect(matchKind(kinds, parse(code))).toBe(expected)
})

test('an unset argument is the first kind', () => {
  expect(matchKind([integer, nothing], undefined)).toBe(0)
})

test.each([
  [null, 'Nothing'],
  [{ kind: 'Text_Input' }, "''"],
  [{ kind: 'Numeric_Input' }, '0'],
  [{ kind: 'Numeric_Input', minimum: 1 }, '1'],
  [{ kind: 'Numeric_Input', minimum: 3 }, '3'],
  [{ kind: 'Numeric_Input', minimum: -5 }, '0'],
  [{ kind: 'Numeric_Input', minimum: 0 }, '0'],
  [{ kind: 'Boolean_Input' }, 'False'],
  [{ kind: 'Date_Input' }, 'Date.today'],
  [{ kind: 'Time_Input' }, 'Time_Of_Day.now'],
  [{ kind: 'Date_Time_Input' }, 'Date_Time.now'],
  [{ kind: 'Regex_Input' }, "regex '.*'"],
  [kase.config, '..Upper'],
  [{ kind: 'Vector_Editor', item_editor: { kind: 'Text_Input' }, item_default: "''" }, '[]'],
  [{ kind: 'File_Browse', file_types: [] }, "''"],
  [{ kind: 'Secret_Browse' }, "Enso_Secret.get ''"],
  [{ kind: 'Any_To_Target' }, undefined],
] as const)('kindDefaultCode(%o)', (config, expected) => {
  expect(kindDefaultCode(config as never)).toBe(expected)
})

test("every kind's default value reads back as that kind", () => {
  const kinds = [
    text,
    regex,
    integer,
    bool,
    date,
    time,
    dateTime,
    kase,
    multi,
    vector,
    file,
    folder,
    secret,
    nothing,
  ]
  kinds.forEach((kind) => {
    const code = kindDefaultCode(kind.config)!
    // Kinds sharing a code shape are never in one union: a text literal is Text before File or
    // Folder (and File before Folder), and a vector literal is Multiple_Choice before Vector_Editor.
    const shadowed =
      kind === file ? [text]
      : kind === folder ? [text, file]
      : kind === vector ? [multi]
      : []
    const others = kinds.filter((k) => !shadowed.includes(k as never))
    expect(matchKind(others, parse(code))).toBe(others.indexOf(kind))
  })
})
