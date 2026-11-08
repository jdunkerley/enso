/** @file The libraries a project could not load, as the Language Server reports them (#600). */
import { shallowRef, type Ref } from 'vue'
import type { LsRpcResult } from 'ydoc-shared/languageServer'
import type { LibraryLoadFailure, response } from 'ydoc-shared/languageServerTypes'

/** The part of the Language Server connection this reads. */
export interface LibraryLoadFailuresSource {
  on(event: 'library/loadFailed', listener: (failure: LibraryLoadFailure) => void): unknown
  listLibraryLoadFailures(): Promise<LsRpcResult<response.ListLibraryLoadFailures>>
}

/** Whether two failures are about the same library (or both about the edition). */
function sameSubject(a: LibraryLoadFailure, b: LibraryLoadFailure) {
  return a.library === b.library && (a.library != null || a.kind === b.kind)
}

/**
 * The libraries the runtime could not load, and an `EditionNotFound` entry first when the project's
 * edition is not installed (it then runs on the bundled edition). Filled from the `library/loadFailed`
 * notifications and, for those sent before this connection, one `library/listLoadFailures` call;
 * one entry per library, the latest report winning. An engine without the method lists nothing.
 */
export function trackLibraryLoadFailures(
  connection: LibraryLoadFailuresSource,
): Readonly<Ref<readonly LibraryLoadFailure[]>> {
  const failures = shallowRef<readonly LibraryLoadFailure[]>([])
  const add = (incoming: readonly LibraryLoadFailure[]) => {
    const kept = failures.value.filter((f) => !incoming.some((i) => sameSubject(f, i)))
    const merged = [...kept, ...incoming]
    // The edition entry, if any, first.
    failures.value = [
      ...merged.filter((f) => f.library == null),
      ...merged.filter((f) => f.library != null),
    ]
  }
  connection.on('library/loadFailed', (failure) => add([failure]))
  void connection.listLibraryLoadFailures().then((result) => {
    if (!result.ok) {
      console.warn('Could not list the libraries that failed to load:', result.error.message())
      return
    }
    // A notification that arrived meanwhile is newer than the listing's copy of the same library.
    const listed = result.value.failures.filter(
      (f) => !failures.value.some((known) => sameSubject(known, f)),
    )
    add(listed)
  })
  return failures
}
