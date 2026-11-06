/** @file Why a project's first execution failed, kept for a view mounted after it (#600). */
import { shallowRef, type Ref } from 'vue'
import type { Diagnostic } from 'ydoc-shared/languageServerTypes'

/** The execution context's events this reads. */
export interface StartupExecutionEvents {
  on(event: 'executionStatus', listener: (diagnostics: Diagnostic[]) => void): unknown
  on(event: 'executionFailed', listener: (message: string) => void): unknown
  on(event: 'executionComplete', listener: () => void): unknown
}

/**
 * Why the project could not start: set when an execution fails before any has completed, to the
 * first error diagnostic of the latest `executionStatus` (the Language Server names a library it
 * could not load there, then fails with `NoSuchElementException`), or else to the failure's
 * message; cleared by the next `executionComplete`. It listens from the execution context's
 * creation, so a failure that comes before the project view mounts is not missed (Note [The
 * Start-up Toast Belongs To Its Project] in `GraphEditor/toasts.ts`).
 */
export function trackStartupFailure(
  executionContext: StartupExecutionEvents,
): Readonly<Ref<string | undefined>> {
  const failure = shallowRef<string>()
  let completed = false
  let latestError: string | undefined
  executionContext.on('executionStatus', (diagnostics) => {
    latestError = diagnostics.find((diagnostic) => diagnostic.kind === 'Error')?.message
  })
  executionContext.on('executionFailed', (message) => {
    if (!completed) failure.value = latestError ?? message
  })
  executionContext.on('executionComplete', () => {
    completed = true
    failure.value = undefined
  })
  return failure
}
