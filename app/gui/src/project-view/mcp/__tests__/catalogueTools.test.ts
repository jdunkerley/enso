/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeMethod,
  makeModuleMethod,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import type { McpToolResult } from 'enso-common/src/mcp'
import { expect, test } from 'vitest'
import {
  DEFAULT_SEARCH_LIMIT,
  getComponentDocs,
  searchComponents,
  type CatalogueDeps,
} from '../catalogueTools'

const LOADING_ERROR = 'The component catalogue is still loading. Try again in a moment.'

function makeDeps(overrides: Partial<CatalogueDeps> = {}): CatalogueDeps {
  const db = SuggestionDb.createMock([
    makeModuleMethod('Standard.Base.Data.read_text', {
      documentation: 'Reads a file as text. More detail.',
    }),
    makeModuleMethod('Standard.Base.Data.read', {
      documentation: 'Reads a file. It guesses the format.',
      returnType: 'Standard.Table.Table.Table',
      args: [
        {
          name: 'path',
          reprType: 'Standard.Base.Data.Text.Text',
          isSuspended: false,
          hasDefault: false,
        },
        {
          name: 'format',
          reprType: 'Standard.Base.Any.Any',
          isSuspended: false,
          hasDefault: true,
          defaultValue: '..Auto_Detect',
          tagValues: ['..Auto_Detect', '..Plain_Text'],
        },
      ],
    }),
    makeModuleMethod('Standard.Base.Data.read_secret', {
      documentation: '---\nprivate: true\n---\n\nNot for users.',
    }),
    makeType('Standard.Base.Data.Text.Text'),
    makeMethod('Standard.Base.Data.Text.Text.to_case', { documentation: 'Changes the case.' }),
    makeType('Standard.Base.Data.Vector.Vector'),
    makeMethod('Standard.Base.Data.Vector.Vector.length'),
    makeType('local.Mock_Project.Main.Thing'),
    makeMethod('local.Mock_Project.Main.Thing.go', { documentation: 'Goes.' }),
  ])
  return {
    db,
    loaded: true,
    projectNames: mockProjectNameStore(),
    importedLibraries: new Set(),
    ...overrides,
  }
}

function value(result: McpToolResult): any {
  if (!result.ok) throw new Error(`Expected a value, got the error: ${result.error}`)
  return JSON.parse(result.value)
}

test('Both tools answer that the catalogue is loading until it has loaded', () => {
  const deps = makeDeps({ loaded: false })
  expect(searchComponents(deps, { query: 'read' })).toEqual({ ok: false, error: LOADING_ERROR })
  expect(getComponentDocs(deps, { name: 'Standard.Base.Data.read' })).toEqual({
    ok: false,
    error: LOADING_ERROR,
  })
})

test('search_components returns the matches best first, with signature and summary', () => {
  const result = value(searchComponents(makeDeps(), { query: 'read' }))
  expect(result).toEqual({
    results: [
      {
        name: 'Standard.Base.Data.read',
        signature: 'Data.read(path: Text, format: Any = ..Auto_Detect) -> Table',
        summary: 'Reads a file.',
      },
      {
        name: 'Standard.Base.Data.read_text',
        signature: 'Data.read_text() -> Any',
        summary: 'Reads a file as text.',
      },
    ],
    total: 2,
  })
})

test('search_components takes at most `limit` matches and counts them all', () => {
  const result = value(searchComponents(makeDeps(), { query: 'read', limit: 1 }))
  expect(result.results.map((r: { name: string }) => r.name)).toEqual(['Standard.Base.Data.read'])
  expect(result.total).toBe(2)
})

test('search_components returns at most DEFAULT_SEARCH_LIMIT matches by default', () => {
  const db = SuggestionDb.createMock(
    Array.from({ length: DEFAULT_SEARCH_LIMIT + 5 }, (_, i) =>
      makeModuleMethod(`Standard.Base.Data.read_${i}`),
    ),
  )
  const result = value(searchComponents(makeDeps({ db }), { query: 'read' }))
  expect(result.results).toHaveLength(DEFAULT_SEARCH_LIMIT)
  expect(result.total).toBe(DEFAULT_SEARCH_LIMIT + 5)
})

test('search_components does not return a private method', () => {
  const result = value(searchComponents(makeDeps(), { query: 'read_secret' }))
  expect(result).toEqual({ results: [], total: 0 })
})

test('get_component_docs reads a component by the name search_components printed', () => {
  const deps = makeDeps()
  const [found] = value(searchComponents(deps, { query: 'read' })).results
  expect(value(getComponentDocs(deps, { name: found.name }))).toEqual({
    name: 'Standard.Base.Data.read',
    signature: 'Data.read(path: Text, format: Any = ..Auto_Detect) -> Table',
    arguments: [
      {
        name: 'path',
        type: 'Standard.Base.Data.Text.Text',
        default: null,
        optional: false,
      },
      {
        name: 'format',
        type: 'Standard.Base.Any.Any',
        default: '..Auto_Detect',
        optional: true,
        values: ['..Auto_Detect', '..Plain_Text'],
      },
    ],
    returns: 'Standard.Table.Table.Table',
    documentation: 'Reads a file. It guesses the format.',
  })
})

test('get_component_docs answers an unknown name with an error', () => {
  expect(getComponentDocs(makeDeps(), { name: 'Standard.Base.Data.write' })).toEqual({
    ok: false,
    error: 'No component named Standard.Base.Data.write. Use a name returned by search_components.',
  })
  expect(getComponentDocs(makeDeps(), { name: 'not a name' }).ok).toBe(false)
})

test('get_component_docs cuts a long documentation', () => {
  const db = SuggestionDb.createMock([
    makeModuleMethod('Standard.Base.Data.read', { documentation: 'x'.repeat(30_000) }),
  ])
  const docs = value(getComponentDocs(makeDeps({ db }), { name: 'Standard.Base.Data.read' }))
  expect(docs.documentation).toBe('x'.repeat(20_000) + '…')
})

test('search_components with `self_type` returns only the methods of that type', () => {
  const result = value(
    searchComponents(makeDeps(), { query: '', self_type: 'Standard.Base.Data.Text.Text' }),
  )
  expect(result).toEqual({
    results: [
      {
        name: 'Standard.Base.Data.Text.Text.to_case',
        signature: 'to_case() -> Any',
        summary: 'Changes the case.',
      },
    ],
    total: 1,
  })
})

test('A type and method of a `Main` module round-trip through their printed names', () => {
  const deps = makeDeps()
  const result = value(
    searchComponents(deps, { query: 'go', self_type: 'local.Mock_Project.Thing' }),
  )
  expect(result.results.map((r: { name: string }) => r.name)).toEqual([
    'local.Mock_Project.Thing.go',
  ])
  const docs = value(getComponentDocs(deps, { name: 'local.Mock_Project.Thing.go' }))
  expect(docs.documentation).toBe('Goes.')
})

test('search_components with an unknown `self_type` answers an error', () => {
  const result = searchComponents(makeDeps(), {
    query: '',
    self_type: 'Standard.Base.Nothing_Here',
  })
  expect(result.ok).toBe(false)
  expect(!result.ok && result.error).toMatch(/^Unknown type Standard\.Base\.Nothing_Here/)
})
