/** @file Which browser pages may open a ydoc socket (#596). */

/* Note [The ydoc Listener Checks Origin]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A ydoc listener binds to loopback only, but a web page in the user's own browser can still open
 * a WebSocket to a loopback port, and the listener's ports sit in a predictable band. Such a socket
 * gets what the IDE gets: it can read and edit the open project. A browser always sends `Origin` on
 * a WebSocket handshake and a page cannot forge it, so a listener answers `403` before the upgrade
 * to any `Origin` that is not the app's own (`allowedOrigins` of the listen request: the Electron
 * window's `https://localhost:<port>`, or the dev server's origin under `dev:vite`). A handshake
 * with no `Origin` is not from a browser page (Node `ws` clients, tools) and is accepted, as the
 * Language Server's `/channel/*` accepts it; another process on the machine is not stopped by
 * this. The opaque origin `null` (a sandboxed frame, a `file:` page) is refused.
 */

/** The origin of `url` (`scheme://host[:port]`), or `undefined` when it is not a URL with a host. */
function originOf(url: string): string | undefined {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * Whether a WebSocket handshake with this `Origin` header may connect: no header, or one of
 * `allowedOrigins` (compared as origins: case, a default port and a trailing slash do not matter).
 * See Note [The ydoc Listener Checks Origin].
 */
export function originAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin == null) return true
  const actual = originOf(origin)
  if (actual == null) return false
  return allowedOrigins.some((allowed) => originOf(allowed) === actual)
}
