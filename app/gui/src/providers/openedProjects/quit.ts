/** @file Closing projects as the app quits, within a time limit per project. */

/**
 * How long the quit waits for one project to close. The shim bounds a close itself (the Language
 * Server is killed after 10 s, the close commit gives up after 15 s); this is a backstop, so that
 * a project that never answers cannot hold the quit for ever.
 */
export const QUIT_CLOSE_TIMEOUT_MS = 30_000

/**
 * Run `close` for each item at once; resolve when each has finished or `timeoutMs` has passed.
 * A failed close is logged, and does not stop the others.
 */
export async function closeEachWithin<T>(
  items: readonly T[],
  close: (item: T) => Promise<unknown>,
  timeoutMs = QUIT_CLOSE_TIMEOUT_MS,
): Promise<void> {
  await Promise.all(
    items.map((item) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
      const closing = Promise.resolve()
        .then(() => close(item))
        .then(
          () => {},
          (error: unknown) => console.error('Could not close a project on quit:', error),
        )
      return Promise.race([closing, timeout]).finally(() => clearTimeout(timer))
    }),
  )
}

/** Which exit dialog to show: syncing hybrid projects, saving versions, both, or none. */
export function exitDialogKind(syncing: boolean, savingVersions: boolean) {
  if (syncing) return savingVersions ? ('both' as const) : ('sync' as const)
  return savingVersions ? ('versions' as const) : null
}
