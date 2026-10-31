import {
  analyzeImports,
  missingImports,
  type RequiredImport,
} from '$/providers/openedProjects/module/imports'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import type { SuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import { makeType } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { Ast } from '@/util/ast'
import type { ProjectPath } from '@/util/projectPath'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { assertDefined } from 'ydoc-shared/util/assert'

const projectNames = mockProjectNameStore()

const projectPath = (path: string) =>
  unwrap(projectNames.parseProjectPath(unwrap(tryQualifiedName(path))))

const db = (...entries: SuggestionEntry[]) => SuggestionDb.createMock(entries)

const POSTGRES = makeType('Standard.Postgres.Postgres.Postgres', {
  reexport: 'Standard.Postgres',
})
const THING = makeType('Standard.Things.Thing.Thing', {
  reexport: 'Standard.Things',
})

const unqualified = (from: string, name: string): RequiredImport => ({
  kind: 'Unqualified',
  from: projectPath(from),
  import: name as Identifier,
})

function detect(
  code: string,
  suggestions: SuggestionDb,
  publicTypes: ReadonlyMap<string, readonly ProjectPath[]> = new Map(),
) {
  const root = Ast.parseBlock(code)
  return missingImports(
    root,
    suggestions,
    [...analyzeImports(root, projectNames)],
    root,
    publicTypes,
  )
}

const CONNECT = "main =\n    db = Database.connect (Postgres.Server 'localhost' 5432)\n"

test('an unimported Postgres.Server needs the Postgres import', () => {
  expect(detect('from Standard.Database import all\n' + CONNECT, db(POSTGRES))).toEqual([
    unqualified('Standard.Postgres', 'Postgres'),
  ])
})

test.each([
  ['imported with all', 'from Standard.Postgres import all\n'],
  ['imported by name', 'from Standard.Postgres import Postgres\n'],
  ['imported qualified', 'import Standard.Postgres.Postgres.Postgres\n'],
])('nothing when the type is %s', (_, imports) => {
  expect(detect(imports + CONNECT, db(POSTGRES))).toEqual([])
})

test('another name imported from the same library does not cover it', () => {
  const imports = 'from Standard.Postgres import Postgres_Connection\n'
  expect(detect(imports + CONNECT, db(POSTGRES))).toEqual([
    unqualified('Standard.Postgres', 'Postgres'),
  ])
})

test('nothing for a local binding of the same name', () => {
  expect(detect('main =\n    Postgres = 42\n    x = Postgres.Server\n', db(POSTGRES))).toEqual([])
})

test('nothing for an ambiguous name', () => {
  const other = makeType('Standard.Other.Thing.Thing', {
    reexport: 'Standard.Other',
  })
  expect(detect('main =\n    x = Thing.new\n', db(THING, other))).toEqual([])
})

test('nothing for a type defined in the project', () => {
  const own = makeType('local.Mock_Project.Main.Postgres')
  expect(detect(CONNECT, db(POSTGRES, own))).toEqual([])
})

test('nothing for an autoscoped constructor', () => {
  expect(detect('main =\n    db = Database.connect ..Postgres\n', db(POSTGRES))).toEqual([])
})

const SQLITE_CODE = 'main =\n    c = Database.connect (SQLite.In_Memory)\n'

test('a type of a library the engine has not loaded comes from the declared types', () => {
  const declared = new Map([['SQLite', [projectPath('Standard.SQLite')]]])
  expect(detect(SQLITE_CODE, db(), declared)).toEqual([unqualified('Standard.SQLite', 'SQLite')])
})

test('the suggestion database wins over the declared types', () => {
  const sqlite = makeType('Standard.Database.SQLite.SQLite', {
    reexport: 'Standard.Database',
  })
  const declared = new Map([['SQLite', [projectPath('Standard.SQLite')]]])
  expect(detect(SQLITE_CODE, db(sqlite), declared)).toEqual([
    unqualified('Standard.Database', 'SQLite'),
  ])
})

test('nothing for a type several libraries declare', () => {
  const declared = new Map([
    ['SQLite', [projectPath('Standard.SQLite'), projectPath('Other.SQLite')]],
  ])
  expect(detect(SQLITE_CODE, db(), declared)).toEqual([])
})

test('only the given scope is looked at', () => {
  const root = Ast.parseBlock('main =\n    a = Postgres.Server\nother =\n    b = Thing.new\n')
  const other = Ast.findModuleMethod(root, 'other')
  assertDefined(other)
  expect(missingImports(root, db(POSTGRES, THING), [], other.statement)).toEqual([
    unqualified('Standard.Things', 'Thing'),
  ])
})
