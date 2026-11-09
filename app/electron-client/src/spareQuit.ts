/** @file Holding a quit until the spare engine has exited. */

/** The slice of Electron's `app` that {@link holdQuitForSpareEngine} uses. */
export interface QuittableApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/**
 * Make every quit wait for the spare engine (`stopSpareEngine`): while one is alive, `before-quit`
 * cancels the quit, stops the spare (a bounded wait, then its tree is killed), and quits again.
 * Without this the IDE exits first, and the spare's own kill timer never fires.
 *
 * It also covers an update installed on quit (`autoInstallOnAppQuit`): `electron-updater` starts
 * the installer on the app's `quit` event, which comes only after the quit that follows the stop.
 * A quit asked for meanwhile waits for the same stop. A quit that something else cancels after the
 * stop leaves no spare for the rest of the session.
 */
export function holdQuitForSpareEngine(
  app: QuittableApp,
  spare: { readonly alive: () => boolean; readonly stop: () => Promise<void> },
): void {
  // Held once: after the stop (even one that gave up on a spare that would not die) a quit goes on.
  let state: 'idle' | 'stopping' | 'done' = 'idle'
  app.on('before-quit', (event) => {
    if (state === 'done' || (state === 'idle' && !spare.alive())) return
    event.preventDefault()
    if (state === 'stopping') return
    state = 'stopping'
    spare
      .stop()
      .catch((error: unknown) => console.error('Failed to stop the spare engine:', error))
      .finally(() => {
        state = 'done'
        app.quit()
      })
  })
}
