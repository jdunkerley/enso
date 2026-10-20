/** @file The check that keeps the app's local server to the app's own window. */
import type * as http from 'node:http'

const HTTP_STATUS_FORBIDDEN = 403

/** The loopback names the app's local server answers to. */
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

/** The values of `Sec-Fetch-Site` a request from the app's own window can carry. */
const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none'])

/** The server a request arrived at, as {@link checkLocalRequest} needs it. */
export interface LocalServerAddress {
  /** The scheme the server speaks. */
  readonly protocol: 'http:' | 'https:'
  /** The port the server listens on. */
  readonly port: number
  /**
   * Host names the server answers to besides the loopback ones, such as a dev server's configured
   * host. Wildcard addresses (`0.0.0.0`, `::`) are ignored: they do not name the server.
   */
  readonly extraHostnames?: readonly string[]
}

/** Whether a request may be served, and if not, why. */
export type LocalRequestVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/** The request headers {@link checkLocalRequest} reads. */
type LocalRequestHeaders = Pick<http.IncomingHttpHeaders, 'host' | 'origin' | 'sec-fetch-site'>

/** Normalise a host name for comparison: lower case, an IPv6 literal in brackets. */
function normaliseHostname(hostname: string): string {
  const lower = hostname.toLowerCase()
  return lower.includes(':') && !lower.startsWith('[') ? `[${lower}]` : lower
}

/** The port a URL with this scheme uses when it names none. */
function defaultPort(protocol: string): number | undefined {
  return (
    protocol === 'https:' ? 443
    : protocol === 'http:' ? 80
    : undefined
  )
}

/** The host names the server answers to. */
function allowedHostnames(server: LocalServerAddress): Set<string> {
  const extra = (server.extraHostnames ?? [])
    .map(normaliseHostname)
    .filter((name) => name !== '' && name !== '0.0.0.0' && name !== '[::]')
  return new Set([...LOOPBACK_HOSTNAMES, ...extra])
}

/** Whether a `Host` header names this server. */
function isAllowedHost(host: string, server: LocalServerAddress): boolean {
  // `Host` is only an authority: anything else in it means it is not one.
  if (/[\s/\\?#@]/.test(host)) return false
  let url: URL
  try {
    url = new URL(`${server.protocol}//${host}`)
  } catch {
    return false
  }
  const port = url.port === '' ? defaultPort(url.protocol) : Number(url.port)
  return port === server.port && allowedHostnames(server).has(normaliseHostname(url.hostname))
}

/** Whether an `Origin` header is this server's own origin. */
function isOwnOrigin(origin: string, server: LocalServerAddress): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    // Includes the opaque origin `null`.
    return false
  }
  if (url.protocol !== server.protocol || url.username !== '' || url.pathname !== '/') return false
  const port = url.port === '' ? defaultPort(url.protocol) : Number(url.port)
  return port === server.port && allowedHostnames(server).has(normaliseHostname(url.hostname))
}

/**
 * Decide whether the app's local server may serve a request.
 *
 * The server holds the user's projects and secrets and can run commands, so it must answer only
 * the app's own window, and tools on the same machine:
 *
 * - **Every request** must carry a `Host` naming this server by a loopback name (or one of
 *   {@link LocalServerAddress.extraHostnames}) and its port. A page that rebinds its own domain to
 *   127.0.0.1 (DNS rebinding) sends its own domain, and is refused.
 * - **`/api/` requests** are refused when they come from another site: a `Sec-Fetch-Site` other
 *   than `same-origin` or `none`, or an `Origin` other than this server's own (by any loopback
 *   name). A request with neither header, such as one from `curl`, is not from a browser page and
 *   is allowed.
 */
export function checkLocalRequest(
  url: string,
  headers: LocalRequestHeaders,
  server: LocalServerAddress,
): LocalRequestVerdict {
  const host = headers.host
  if (host == null || !isAllowedHost(host, server)) {
    return { allowed: false, reason: `Host '${host ?? ''}' does not name this server.` }
  }
  if (url.startsWith('/api/')) {
    const fetchSite = headers['sec-fetch-site']
    if (fetchSite != null && !ALLOWED_FETCH_SITES.has(fetchSite.toLowerCase())) {
      return { allowed: false, reason: `Cross-site request (Sec-Fetch-Site: ${fetchSite}).` }
    }
    const origin = headers.origin
    if (origin != null && !isOwnOrigin(origin, server)) {
      return { allowed: false, reason: `Request from another origin (${origin}).` }
    }
  }
  return { allowed: true }
}

/**
 * Answer `403 Forbidden` to a request {@link checkLocalRequest} refuses.
 * @returns Whether the request may be served; when `false`, the response has been sent.
 */
export function acceptLocalRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  server: LocalServerAddress,
  headers: Readonly<Record<string, string>> = {},
): boolean {
  const verdict = checkLocalRequest(request.url ?? '', request.headers, server)
  if (verdict.allowed) return true
  console.warn(`Refused ${request.method ?? ''} ${request.url ?? ''}: ${verdict.reason}`)
  const body = Buffer.from(`Forbidden: ${verdict.reason}`)
  response
    .writeHead(HTTP_STATUS_FORBIDDEN, {
      ...headers,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(body.byteLength),
    })
    .end(body)
  return false
}
