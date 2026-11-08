import {
  makeArgument,
  makeModuleMethod,
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
  expect(signature.name).toBe('read')
  expect(signature.params).toEqual([
    { name: 'path', detail: 'Text = Missing_Argument.throw "path"', optional: false },
    { name: 'format', detail: 'File_Format = Auto_Detect', optional: true },
    { name: 'action', detail: '~Any', optional: false },
  ])
  expect(signature.label).toBe(
    'read(path: Text = Missing_Argument.throw "path", format: File_Format = Auto_Detect, action: ~Any) -> Any',
  )
})

test('a callable with no arguments but `self` has an empty argument list', () => {
  const entry = makeModuleMethod('Standard.Base.Data.Text.Text.to_text', {
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
  expect(signature.label).toBe('pi() -> Any')
})
