import type { CallableSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeConstructor,
  makeMethod,
  makeModuleMethod,
  makeStaticMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { entrySignature, unqualifiedType } from '@/components/ComponentHelp/signature'
import { expect, test } from 'vitest'

const withDefault = (name: string, type: string, defaultValue: string) => ({
  ...makeArgument(name, type),
  hasDefault: true,
  defaultValue,
})

test('unqualifiedType shortens every qualified name', () => {
  expect(unqualifiedType('Standard.Base.Data.Text.Text | Standard.Base.System.File.File')).toBe(
    'Text | File',
  )
})

test('the signature drops `self` and marks optional arguments, as the docs site does', () => {
  const entry = makeModuleMethod('Standard.Base.Data.read', {
    args: [
      makeArgument('self', 'Standard.Base.Data'),
      withDefault('path', 'Standard.Base.Data.Text.Text', 'Missing_Argument.throw "path"'),
      withDefault('format', 'Standard.Base.System.File_Format.File_Format', 'Auto_Detect'),
      { ...makeArgument('action'), isSuspended: true },
    ],
  })
  const signature = entrySignature(entry, 'Standard.Base.Any.Any')
  expect(signature.name).toBe('Data.read')
  expect(
    signature.params.map((p) => ({
      name: p.name,
      type: p.type,
      default: p.default,
      optional: p.optional,
    })),
  ).toEqual([
    { name: 'path', type: 'Text', default: 'Missing_Argument.throw "path"', optional: false },
    { name: 'format', type: 'File_Format', default: 'Auto_Detect', optional: true },
    { name: 'action', type: '~Any', default: undefined, optional: false },
  ])
  expect(signature.returns).toBe('Any')
  expect(signature.label).toBe(
    'Data.read(path: Text = Missing_Argument.throw "path", format: File_Format = Auto_Detect, action: ~Any) -> Any',
  )
})

test('a callable with no arguments but `self` has an empty argument list', () => {
  const entry = makeMethod('Standard.Base.Data.Text.Text.to_text', {
    args: [makeArgument('self', 'Standard.Base.Data.Text.Text')],
  })
  const signature = entrySignature(entry, 'Standard.Base.Data.Text.Text')
  expect(signature.params).toEqual([])
  expect(signature.label).toBe('to_text() -> Text')
})

test('a callable with no arguments at all', () => {
  const signature = entrySignature(
    makeModuleMethod('Standard.Base.Main.pi'),
    'Standard.Base.Any.Any',
  )
  expect(signature.params).toEqual([])
  expect(signature.label).toBe('Base.pi() -> Any')
})

test('a static method is named with its type, as a node calls it', () => {
  const entry = makeStaticMethod('Standard.Base.Data.Time.Date.Date.new', {
    args: [makeArgument('year', 'Standard.Base.Data.Numbers.Integer')],
  }) as CallableSuggestionEntry
  const signature = entrySignature(entry, 'Standard.Base.Data.Time.Date.Date')
  expect(signature.name).toBe('Date.new')
  expect(signature.label).toBe('Date.new(year: Integer) -> Date')
})

test('a constructor is named with its type', () => {
  const signature = entrySignature(
    makeConstructor('Standard.Base.Data.Time.Period.Period.Value') as CallableSuggestionEntry,
    'Standard.Base.Data.Time.Period.Period',
  )
  expect(signature.name).toBe('Period.Value')
})
