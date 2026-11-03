/** @file Resolving a widget option's `requires` type name to the imports it needs (#489). */
import {
  requiredImportsForTypeName,
  type RequiredImport,
} from '$/providers/openedProjects/module/imports'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { makeType } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import type { ProjectPath } from '@/util/projectPath'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'

const projectNames = mockProjectNameStore()
const projectPath = (path: string) =>
  unwrap(projectNames.parseProjectPath(unwrap(tryQualifiedName(path))))
const unqualified = (from: string, name: string): RequiredImport => ({
  kind: 'Unqualified',
  from: projectPath(from),
  import: name as Identifier,
})

const SQLITE_FORMAT_QN = 'Standard.SQLite.SQLite_Format.SQLite_Format'
const sqliteFormat = () => makeType(SQLITE_FORMAT_QN, { reexport: 'Standard.SQLite' })
const noTypes = new Map<string, readonly ProjectPath[]>()

test('a type in the suggestion database gives its entry’s import', () => {
  const db = SuggestionDb.createMock([sqliteFormat()])
  expect(requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN)).toEqual([
    unqualified('Standard.SQLite', 'SQLite_Format'),
  ])
})

test('a catalogue entry counts like any other', () => {
  const entry = sqliteFormat()
  entry.fromCatalogue = true
  const db = SuggestionDb.createMock([entry])
  expect(requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN)).toEqual([
    unqualified('Standard.SQLite', 'SQLite_Format'),
  ])
})

test('a type only its library declares gives the import from that library', () => {
  const declared = new Map([['SQLite_Format', [projectPath('Standard.SQLite')]]])
  const db = SuggestionDb.createMock([])
  expect(requiredImportsForTypeName(db, projectNames, declared, SQLITE_FORMAT_QN)).toEqual([
    unqualified('Standard.SQLite', 'SQLite_Format'),
  ])
})

test('the same name declared by another library does not count', () => {
  const declared = new Map([['SQLite_Format', [projectPath('Standard.Other')]]])
  const db = SuggestionDb.createMock([])
  expect(requiredImportsForTypeName(db, projectNames, declared, SQLITE_FORMAT_QN)).toBeUndefined()
})

test('an unknown type gives nothing', () => {
  const db = SuggestionDb.createMock([])
  expect(requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN)).toBeUndefined()
})

test('a value that is not a qualified name gives nothing', () => {
  const db = SuggestionDb.createMock([sqliteFormat()])
  expect(requiredImportsForTypeName(db, projectNames, noTypes, '..SQLite')).toBeUndefined()
})
