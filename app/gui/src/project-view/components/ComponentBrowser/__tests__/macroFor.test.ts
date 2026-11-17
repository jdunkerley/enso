import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { ComputedValueRegistry } from '$/providers/openedProjects/project/computedValueRegistry'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeConstructor,
  makeModuleMethod,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { makeComponentLists } from '@/components/ComponentBrowser/component'
import { Filtering } from '@/components/ComponentBrowser/filtering'
import { useComponentBrowserInput } from '@/components/ComponentBrowser/input'
import { stdPath } from '@/util/projectPath'
import { expect, test } from 'vitest'
import { ref } from 'vue'

function contribution(target: string, macro: string) {
  return `---\nmacro_for:\n  - target: ${target}\n    macros:\n      - ${macro}\n---\nA contribution.`
}

function mockDb() {
  const db = new SuggestionDb()
  db.set(1, makeModuleMethod('Standard.Database.Connection.Database.connect'))
  db.set(2, makeModuleMethod('Standard.Base.Data.read'))
  db.set(3, makeType('Standard.SQLite.SQLite.SQLite', { reexport: 'Standard.SQLite' }))
  db.set(
    4,
    makeConstructor('Standard.SQLite.SQLite.SQLite.From_File', {
      documentation: contribution(
        'Standard.Database.Connection.Database.connect',
        'sqlite: details=SQLite.From_File',
      ),
    }),
  )
  db.set(5, makeType('Standard.Excel.Excel_Format.Excel_Format', { reexport: 'Standard.Excel' }))
  db.set(
    6,
    makeConstructor('Standard.Excel.Excel_Format.Excel_Format.Workbook', {
      documentation: contribution('Standard.Base.Data.read', 'excel: format=..Workbook'),
    }),
  )
  return db
}

function offered(db: SuggestionDb, pattern: string) {
  return makeComponentLists(db, new Filtering({ pattern }))
    .get('all')!
    .filter((component) => component.macroSuffix != null)
}

function newInput(db: SuggestionDb) {
  const input = useComponentBrowserInput(GraphDb.Mock(ComputedValueRegistry.Mock()), db, ref())
  input.reset({ type: 'newNode' })
  return input
}

test('A contributed macro is offered on its target', () => {
  const [component] = offered(mockDb(), 'sqlite')
  expect(component).toMatchObject({
    suggestionId: 1,
    macroSuffix: 'details=SQLite.From_File',
    macroContributor: 4,
  })
})

test('Without the contributing library, no shortcut is offered', () => {
  const db = mockDb()
  db.delete(4)
  expect(offered(db, 'sqlite')).toEqual([])
})

test('Accepting a contributed macro adds the contributing library import', () => {
  const db = mockDb()
  const [component] = offered(db, 'sqlite')
  const input = newInput(db)
  expect(
    input.applySuggestion(
      component!.suggestionId!,
      component!.macroSuffix,
      component!.macroContributor,
    ).ok,
  ).toBe(true)
  expect(input.code).toBe('Database.connect details=SQLite.From_File')
  expect(input.importsToAdd()).toEqual(
    expect.arrayContaining([
      { kind: 'Unqualified', from: stdPath('Standard.SQLite'), import: 'SQLite' },
    ]),
  )
})

test('An autoscoped macro keeps the import although its code does not name the type', () => {
  const db = mockDb()
  const [component] = offered(db, 'excel')
  const input = newInput(db)
  input.applySuggestion(
    component!.suggestionId!,
    component!.macroSuffix,
    component!.macroContributor,
  )
  expect(input.code).toBe('Data.read format=..Workbook')
  expect(input.importsToAdd()).toEqual(
    expect.arrayContaining([
      { kind: 'Unqualified', from: stdPath('Standard.Excel'), import: 'Excel_Format' },
    ]),
  )
})

test('Editing the macro away drops its import', () => {
  const db = mockDb()
  const [component] = offered(db, 'excel')
  const input = newInput(db)
  input.applySuggestion(
    component!.suggestionId!,
    component!.macroSuffix,
    component!.macroContributor,
  )
  input.content = { text: 'Data.read ', selection: input.selection }
  expect(input.importsToAdd()).toEqual([])
})
