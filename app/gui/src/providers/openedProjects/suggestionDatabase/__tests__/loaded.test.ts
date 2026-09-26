import type { ProjectStore } from '$/providers/openedProjects/project'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { createSuggestionDbStore } from '$/providers/openedProjects/suggestionDatabase'
import { Ok } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { effectScope } from 'vue'
import type { LanguageServer } from 'ydoc-shared/languageServer'

/** A language server whose initial suggestion database is sent only when `sendDatabase` is called. */
function mockLanguageServer() {
  let sendDatabase!: () => void
  const database: ReturnType<LanguageServer['getSuggestionsDatabase']> = new Promise<void>(
    (resolve) => (sendDatabase = resolve),
  ).then(() => Ok({ entries: [], currentVersion: 1 }))
  const lsRpc: Partial<LanguageServer> = {
    isDisposed: false,
    acquireCapability: async () => Ok(undefined),
    getComponentGroups: async () =>
      Ok({ componentGroups: [{ library: 'Standard.Base', name: 'Input', exports: [] }] }),
    getSuggestionsDatabase: () => database,
    on: ((_event: unknown, callback: unknown) => callback) as LanguageServer['on'],
    off: (() => {}) as LanguageServer['off'],
  }
  return { lsRpc: lsRpc as LanguageServer, sendDatabase }
}

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
  // Groups arrive first; the database is requested after them.
  await vi.waitFor(() => expect(store.groups).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(store.loaded).toBe(false)
  sendDatabase()
  await vi.waitFor(() => expect(store.loaded).toBe(true))
  scope.stop()
})
