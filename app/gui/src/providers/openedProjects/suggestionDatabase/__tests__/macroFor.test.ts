import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeConstructor,
  makeModuleMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { validateMetadata } from '@/components/ComponentHelp/metadata'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { parse as yamlParse } from 'yaml'

const TARGET = 'Standard.Database.Connection.Database.connect'

function contribution(target: string, macros: Record<string, string>) {
  const lines = Object.entries(macros).map(([name, value]) => `      - ${name}: ${value}`)
  return [
    '---',
    'macro_for:',
    `  - target: ${target}`,
    '    macros:',
    ...lines,
    '---',
    'A backend.',
  ].join('\n')
}

function connect(documentation?: string) {
  return makeModuleMethod(TARGET, documentation != null ? { documentation } : {})
}

function sqlite(macros: Record<string, string> = { sqlite: 'details=SQLite.From_File' }) {
  return makeConstructor('Standard.SQLite.SQLite.From_File', {
    documentation: contribution(TARGET, macros),
  })
}

function macroNames(db: SuggestionDb, id: number) {
  return [...db.macrosOf(db.get(id)!).keys()].sort()
}

describe('macro_for metadata', () => {
  test('is parsed as a list of targets with their macros', () => {
    const parsed = yamlParse(contribution(TARGET, { a: 'x=1', b: 'y=2' }).split('---')[1]!)
    const result = validateMetadata(parsed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.macro_for).toEqual([
      {
        target: TARGET,
        macros: [
          { description: 'a', value: 'x=1' },
          { description: 'b', value: 'y=2' },
        ],
      },
    ])
  })

  test('a macro element with two entries is rejected, as for `macros`', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = validateMetadata({
      // eslint-disable-next-line camelcase
      macro_for: [{ target: TARGET, macros: [{ a: '1', b: '2' }] }],
    })
    expect(result.ok && result.value.macro_for).toBeUndefined()
    spy.mockRestore()
  })
})

describe('contributed macros', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  test('the contributor is indexed after the target', () => {
    const db = new SuggestionDb()
    db.set(1, connect())
    expect(macroNames(db, 1)).toEqual([])
    db.set(2, sqlite())
    expect(macroNames(db, 1)).toEqual(['sqlite'])
    expect(db.macrosOf(db.get(1)!).get('sqlite')).toEqual({
      value: 'details=SQLite.From_File',
      contributor: 2,
    })
    expect(db.aliasesAndMacrosOf(db.get(1)!)).toContain('sqlite')
  })

  test('the contributor is indexed before the target', () => {
    const db = new SuggestionDb()
    db.set(2, sqlite())
    db.set(1, connect())
    expect(macroNames(db, 1)).toEqual(['sqlite'])
  })

  test('removing the contributor removes its macros', () => {
    const db = new SuggestionDb()
    db.set(1, connect())
    db.set(2, sqlite())
    db.delete(2)
    expect(macroNames(db, 1)).toEqual([])
    expect(db.aliasesAndMacrosOf(db.get(1)!)).toEqual(db.get(1)!.aliasesAndMacros)
  })

  test('modifying the contributor replaces its macros', () => {
    const db = new SuggestionDb()
    db.set(1, connect())
    db.set(2, sqlite())
    db.set(2, sqlite({ sqlite3: 'details=SQLite.From_File' }))
    expect(macroNames(db, 1)).toEqual(['sqlite3'])
  })

  test('the target keeps its own macros', () => {
    const db = new SuggestionDb()
    db.set(1, connect('---\nmacros:\n  - own: a=1\n---\nConnects.'))
    db.set(2, sqlite())
    expect(macroNames(db, 1)).toEqual(['own', 'sqlite'])
    expect(db.macrosOf(db.get(1)!).get('own')).toEqual({ value: 'a=1' })
  })

  test("the target's own macro wins a clash, and the clash is logged", () => {
    const db = new SuggestionDb()
    db.set(1, connect('---\nmacros:\n  - sqlite: own=1\n---\nConnects.'))
    db.set(2, sqlite())
    expect(db.macrosOf(db.get(1)!).get('sqlite')).toEqual({ value: 'own=1' })
    expect(warn).toHaveBeenCalled()
  })

  test('of two contributors, the library that sorts first wins', () => {
    const db = new SuggestionDb()
    db.set(1, connect())
    db.set(
      2,
      makeConstructor('Standard.Zeta.Z.Value', {
        documentation: contribution(TARGET, { shared: 'z=1' }),
      }),
    )
    db.set(
      3,
      makeConstructor('Standard.Alpha.A.Value', {
        documentation: contribution(TARGET, { shared: 'a=1' }),
      }),
    )
    expect(db.macrosOf(db.get(1)!).get('shared')).toEqual({ value: 'a=1', contributor: 3 })
    expect(warn).toHaveBeenCalled()
  })

  test('macros for another target are not offered', () => {
    const db = new SuggestionDb()
    db.set(1, connect())
    db.set(
      2,
      makeConstructor('Standard.SQLite.SQLite.From_File', {
        documentation: contribution('Standard.Base.Data.read', { sqlite: 'x=1' }),
      }),
    )
    expect(macroNames(db, 1)).toEqual([])
  })
})
