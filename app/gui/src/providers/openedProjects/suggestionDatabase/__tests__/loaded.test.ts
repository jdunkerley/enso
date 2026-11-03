import type { ProjectStore } from '$/providers/openedProjects/project'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { createSuggestionDbStore } from '$/providers/openedProjects/suggestionDatabase'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'
import { LsRpcError, type LanguageServer } from 'ydoc-shared/languageServer'

/** A language server whose initial suggestion database is sent only when `sendDatabase` is called. */
function mockLanguageServer(overrides: Partial<LanguageServer> = {}) {
  let sendDatabase!: () => void
  const database: ReturnType<LanguageServer['getSuggestionsDatabase']> = new Promise<void>(
    (resolve) => (sendDatabase = resolve),
  ).then(() => Ok({ entries: [], currentVersion: 1 }))
  const lsRpc: Partial<LanguageServer> = {
    isDisposed: false,
    acquireCapability: async () => Ok(undefined),
    getComponentGroups: async () =>
      Ok({ componentGroups: [{ library: 'Standard.Base', name: 'Input', exports: [] }] }),
    listLibraryPublicTypes: async () => Ok({ publicTypes: [] }),
    getSuggestionsDatabase: () => database,
    on: ((_event: unknown, callback: unknown) => callback) as LanguageServer['on'],
    off: (() => {}) as LanguageServer['off'],
    ...overrides,
  }
  return { lsRpc: lsRpc as LanguageServer, sendDatabase }
}

function createStore(lsRpc: LanguageServer) {
  const projectStore: Partial<ProjectStore> = {
    lsRpcConnection: lsRpc,
    firstExecution: Promise.resolve() as Promise<unknown> as ProjectStore['firstExecution'],
  }
  const scope = effectScope()
  const store = scope.run(() =>
    createSuggestionDbStore(projectStore as ProjectStore, mockProjectNameStore()),
  )!
  return { store, scope }
}

describe('the libraries declared types', () => {
  test('are keyed by type name', async () => {
    const { lsRpc } = mockLanguageServer({
      listLibraryPublicTypes: async () =>
        Ok({ publicTypes: [{ name: 'SQLite', library: 'Standard.SQLite' }] }),
    })
    const { store, scope } = createStore(lsRpc)
    await vi.waitFor(() => expect(store.publicTypesLoaded).toBe(true))
    expect([...store.libraryPublicTypes.keys()]).toEqual(['SQLite'])
    scope.stop()
  })

  test('are empty, without retrying, when the engine lacks the method', async () => {
    const listLibraryPublicTypes = vi.fn(async () =>
      Err(
        new LsRpcError(
          Object.assign(new Error('Method not found'), { code: -32601 }),
          'library/listPublicTypes',
          {},
        ),
      ),
    )
    const { lsRpc } = mockLanguageServer({ listLibraryPublicTypes })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store, scope } = createStore(lsRpc)
    await vi.waitFor(() => expect(store.publicTypesLoaded).toBe(true), { timeout: 500 })
    expect(store.libraryPublicTypes.size).toBe(0)
    expect(listLibraryPublicTypes).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    scope.stop()
  })

  test('are empty, and loading is over, when the request throws', async () => {
    const { lsRpc } = mockLanguageServer({
      listLibraryPublicTypes: async () => {
        throw new Error('boom')
      },
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, scope } = createStore(lsRpc)
    await vi.waitFor(() => expect(store.publicTypesLoaded).toBe(true), { timeout: 500 })
    expect(store.libraryPublicTypes.size).toBe(0)
    error.mockRestore()
    scope.stop()
  })

  test('are empty, and loading is over, when the request never answers', async () => {
    vi.useFakeTimers()
    try {
      const { lsRpc } = mockLanguageServer({ listLibraryPublicTypes: () => new Promise(() => {}) })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { store, scope } = createStore(lsRpc)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(store.publicTypesLoaded).toBe(true)
      expect(store.libraryPublicTypes.size).toBe(0)
      error.mockRestore()
      scope.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

test('the store is loaded only once the initial suggestion database is, not merely the groups', async () => {
  const { lsRpc, sendDatabase } = mockLanguageServer()
  const projectStore: Partial<ProjectStore> = {
    lsRpcConnection: lsRpc,
    // Only awaited, never read.
    firstExecution: Promise.resolve() as Promise<unknown> as ProjectStore['firstExecution'],
  }
  const scope = effectScope()
  const store = scope.run(() =>
    createSuggestionDbStore(projectStore as ProjectStore, mockProjectNameStore()),
  )!
  expect(store.loaded).toBe(false)
  // Groups arrive first; the database answers after them.
  await vi.waitFor(() => expect(store.groups).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(store.loaded).toBe(false)
  sendDatabase()
  await vi.waitFor(() => expect(store.loaded).toBe(true))
  scope.stop()
})

test('the suggestion database is requested before the first execution', async () => {
  const getSuggestionsDatabase = vi.fn(() => new Promise<never>(() => {}))
  const { lsRpc } = mockLanguageServer({ getSuggestionsDatabase })
  const projectStore: Partial<ProjectStore> = {
    lsRpcConnection: lsRpc,
    // Never settles: the first execution has not finished.
    firstExecution: new Promise<never>(
      () => {},
    ) as Promise<unknown> as ProjectStore['firstExecution'],
  }
  const scope = effectScope()
  scope.run(() => createSuggestionDbStore(projectStore as ProjectStore, mockProjectNameStore()))
  await vi.waitFor(() => expect(getSuggestionsDatabase).toHaveBeenCalledTimes(1))
  scope.stop()
})
