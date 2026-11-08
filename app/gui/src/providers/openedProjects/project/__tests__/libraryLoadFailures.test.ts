import { trackLibraryLoadFailures } from '$/providers/openedProjects/project/libraryLoadFailures'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { ObservableV2 } from 'lib0/observable'
import { expect, test, vi } from 'vitest'
import { LsRpcError } from 'ydoc-shared/languageServer'
import type { LibraryLoadFailure } from 'ydoc-shared/languageServerTypes'

const table: LibraryLoadFailure = {
  library: 'Standard.Table',
  version: '0.0.0-dev',
  kind: 'DownloadFailed',
  message: 'HTTP 502',
}
const edition: LibraryLoadFailure = {
  library: null,
  version: '2025.1.1',
  kind: 'EditionNotFound',
  message: 'not found',
}

/** A connection whose listing answers `listed` when `answer` is called. */
function fakeConnection(listed: LibraryLoadFailure[] | 'error' | 'malformed') {
  const events = new ObservableV2<{ 'library/loadFailed': (f: LibraryLoadFailure) => void }>()
  let answer!: () => void
  const listing = new Promise<void>((resolve) => (answer = resolve))
  const connection = {
    on: (event: 'library/loadFailed', listener: (f: LibraryLoadFailure) => void) =>
      events.on(event, listener),
    listLibraryLoadFailures: vi.fn(async () => {
      await listing
      if (listed === 'malformed') return Ok(null as never)
      return listed === 'error' ?
          Err(new LsRpcError('Method not found', 'library/listLoadFailures', {}))
        : Ok({ failures: listed })
    }),
  }
  return {
    connection,
    notify: (f: LibraryLoadFailure) => events.emit('library/loadFailed', [f]),
    answer: async () => {
      answer()
      await new Promise((resolve) => setTimeout(resolve))
    },
  }
}

test('the listing gives the failures reported before connecting, the edition first', async () => {
  const { connection, answer } = fakeConnection([table, edition])
  const failures = trackLibraryLoadFailures(connection as never)
  expect(failures.value).toEqual([])
  await answer()
  expect(failures.value).toEqual([edition, table])
})

test('a notification adds a library, and a newer one replaces it', async () => {
  const { connection, notify, answer } = fakeConnection([])
  const failures = trackLibraryLoadFailures(connection as never)
  notify(table)
  const newer = { ...table, kind: 'LoadingError' as const, message: 'corrupt' }
  notify(newer)
  // The listing, answered later, holds an older copy of the same library.
  await answer()
  expect(failures.value).toEqual([newer])
})

test('a listing that fails leaves what the notifications said', async () => {
  const { connection, notify, answer } = fakeConnection('error')
  const failures = trackLibraryLoadFailures(connection as never)
  notify(table)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await answer()
  expect(failures.value).toEqual([table])
})

test('a malformed listing (an Ok with no result) lists nothing, and rejects nothing', async () => {
  const { connection, notify, answer } = fakeConnection('malformed')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const failures = trackLibraryLoadFailures(connection as never)
  notify(table)
  await answer()
  expect(failures.value).toEqual([table])
  expect(warn).toHaveBeenCalled()
})
