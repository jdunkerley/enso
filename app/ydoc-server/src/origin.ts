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
  // GraalJS, which runs the engine-hosted listener (#614), has no `URL`.
  if (typeof URL !== 'function') return parseOrigin(url)
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/** The ports a scheme uses when a URL names none, which an origin leaves out. */
const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' }

/**
 * `http(s)://host[:port]`, then optionally a path, query or fragment (ignored). The only IPv6 host
 * is `[::1]`, the one the app's origins use.
 */
const ORIGIN_PATTERN = /^(https?:)\/\/(\[::1\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:[/?#].*)?$/i

/**
 * Whether `URL` would keep `host` as it is (after lower-casing). It rewrites IPv4 addresses in any
 * form but the dotted quad (`127.1`, `0x7f.0.0.1`, `2130706433`: a host whose last label is a
 * number is an IPv4 address to it), and it decodes or rejects punycode (`xn--`). Such hosts, and
 * empty labels (`localhost.`, `a..b`), are refused rather than compared in a form `URL` would not
 * produce.
 */
function canonicalHost(host: string): boolean {
  if (host.startsWith('[')) return true
  const labels = host.split('.')
  if (labels.some((label) => label === '' || label.startsWith('xn--'))) return false
  if (!/^(0x[0-9a-f]*|\d+)$/.test(labels[labels.length - 1]!)) return true
  return (
    labels.length === 4 &&
    labels.every((label) => /^(0|[1-9]\d{0,2})$/.test(label) && Number(label) <= 255)
  )
}

/**
 * {@link originOf} without `URL`, for plain origins as browsers send them and as the app's own
 * origins are written: `http` or `https` only, the scheme and host in lower case, the default port
 * left out. Anything else (another scheme, user info, a non-ASCII or non-canonical host) is
 * `undefined`, so it is refused, never let in. Exported for its tests, which hold it to `URL`'s
 * answers.
 */
export function parseOrigin(url: string): string | undefined {
  const match = ORIGIN_PATTERN.exec(url)
  if (match == null) return undefined
  const scheme = match[1]!.toLowerCase()
  const host = match[2]!.toLowerCase()
  if (!canonicalHost(host)) return undefined
  const rawPort = match[3]
  const port = rawPort == null ? undefined : String(Number(rawPort))
  if (port != null && Number(port) > 65535) return undefined
  return port == null || port === DEFAULT_PORTS[scheme] ?
      `${scheme}//${host}`
    : `${scheme}//${host}:${port}`
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
