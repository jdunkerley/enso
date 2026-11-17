/**
 * Addresses of files inside a language-server content root, as the visualization compiler sees
 * them: `enso-root:<rootId>/<segment>/<segment>`.
 *
 * The form has no slash after the colon. A non-special scheme with a path starting `/` would parse
 * with an empty authority; this one has an opaque path, which `new URL` leaves alone, so
 * {@link resolveRelativeImport} does the dot-segment resolution itself.
 *
 * This module is imported by both the compiler worker and the main thread, so keep it free of
 * anything that needs the DOM.
 */

import type { Uuid } from 'ydoc-shared/languageServerTypes'

/** The custom URL protocol used internally for files in a content root. */
export const rootAddressProtocol = 'enso-root:'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The address of the file at `segments` inside the content root `rootId`. */
export function rootAddress(rootId: Uuid, segments: readonly string[]): string {
  return `${rootAddressProtocol}${rootId}/${segments.map(encodeURIComponent).join('/')}`
}

/**
 * Split an address made by {@link rootAddress}; `undefined` if it is not one. A segment that is `.`
 * or `..`, or that holds a `/` or `\` once decoded, is not a name inside the root, so such an
 * address is refused rather than handed on to a reader that might treat it as a path.
 */
export function parseRootAddress(
  address: string,
): { rootId: Uuid; segments: string[] } | undefined {
  if (!address.startsWith(rootAddressProtocol)) return undefined
  const [rootId, ...encodedSegments] = address.slice(rootAddressProtocol.length).split('/')
  if (rootId == null || !UUID_PATTERN.test(rootId)) return undefined
  try {
    const segments = encodedSegments.map(decodeURIComponent)
    if (
      segments.some(
        (segment) =>
          segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'),
      )
    )
      return undefined
    return { rootId: rootId as Uuid, segments }
  } catch {
    return undefined
  }
}

/**
 * Resolve the import `path` of a module in directory `dir` (an address, or an absolute URL, ending
 * in `/`). Addresses that are not `http(s)` etc. come back as `protocol + normalised path`.
 *
 * An import from a file in a content root must stay in that root: the resolver clamps `..` at the
 * top, which would otherwise turn `../../<other root id>/x.vue` into a file of another root. Such
 * an import throws, which the compiler reports as an error compiling the importing file.
 */
export function resolveRelativeImport(dir: string, path: string, baseHref: string): string {
  const url = new URL(dir + path, baseHref)
  if (!/^(?:data|https?|ftps?|wss?):$/.test(url.protocol)) {
    const resolved = url.protocol + new URL('http://example.com/' + url.pathname).pathname.slice(1)
    const from = parseRootAddress(dir)
    if (from && parseRootAddress(resolved)?.rootId !== from.rootId) {
      throw new Error(`The import '${path}' of '${dir}' reaches outside its content root.`)
    }
    return resolved
  } else {
    return url.href
  }
}
