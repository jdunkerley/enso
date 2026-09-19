/** @file Resolution of HTTP request paths to files on disk, for the content server. */
import * as path from 'node:path'

/**
 * Resolve a request path to a file inside `baseDir`, or `null` if it does not name one.
 *
 * Request paths are percent-encoded, so they must be decoded before they can name a file on disk:
 * the bundled font `font-mplus1/MPLUS1[wght].ttf` arrives as `font-mplus1/MPLUS1%5Bwght%5D.ttf`,
 * and passing that straight to `readFile` 404s.
 *
 * Decoding is also what makes confinement necessary — `%2e%2e%2f` decodes to `../`, which would
 * otherwise walk out of the served directory — so the resolved path is checked to lie under
 * `baseDir` before being returned.
 */
export function resolveServedFile(baseDir: string, requestPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    // Malformed percent-encoding, e.g. a bare `%`.
    return null
  }
  // A NUL byte truncates the path for some syscalls.
  if (decoded.includes('\0')) return null
  const root = path.resolve(baseDir)
  const resolved = path.resolve(root, decoded.replace(/^[/\\]+/, ''))
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null
}
