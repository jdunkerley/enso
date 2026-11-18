/**
 * @file Checking the paths the MCP app tools are given against the Drive's root and the saved local
 * folders: the security boundary of the app tools.
 */

// === Paths ===

/** A path taken apart: its root (`C:`, `//server/share` or `` for POSIX) and its segments. */
interface ParsedPath {
  readonly prefix: string
  readonly segments: readonly string[]
}

/**
 * Whether paths compare as on Windows. Decided by the root's own form (a drive letter or a UNC
 * path), not by the platform the GUI runs on: this runs in the renderer, and the roots are what the
 * backend spells.
 */
function isWindowsForm(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || /^[\\/]{2}[^\\/]/.test(root)
}

/**
 * Parses an absolute path, resolving `.` and `..`; `null` when it is relative, empty, climbs above
 * its root, or is one Windows would read differently from how it is spelt.
 *
 * On Windows both separators count, the path must start with a drive (`C:\`) or a UNC share
 * (`\\server\share`), and device paths (`\\?\`, `\\.\`), segments with `:` (alternate data
 * streams) and segments ending in a dot or a space (which Windows strips, so `.. ` would be `..`)
 * are refused. On POSIX only `/` separates; a backslash is part of a name.
 */
function parsePath(path: string, windows: boolean): ParsedPath | null {
  if (path.includes('\0')) return null
  let prefix: string
  let rest: string
  if (windows) {
    const slashed = path.replace(/\\/g, '/')
    const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed)
    const unc = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(slashed)
    if (drive != null) {
      prefix = `${drive[1]!.toUpperCase()}:`
      rest = drive[2]!
    } else if (unc != null && unc[1] !== '?' && unc[1] !== '.') {
      prefix = `//${unc[1]}/${unc[2]}`
      rest = unc[3] ?? ''
    } else {
      return null
    }
  } else {
    if (!path.startsWith('/')) return null
    prefix = ''
    rest = path
  }
  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.pop() == null) return null
      continue
    }
    if (windows && (/[. ]$/.test(segment) || segment.includes(':'))) return null
    segments.push(segment)
  }
  return { prefix, segments }
}

function formatPath({ prefix, segments }: ParsedPath, windows: boolean): string {
  if (segments.length === 0)
    return windows && !prefix.startsWith('//') ? `${prefix}/` : prefix || '/'
  return `${prefix}/${segments.join('/')}`
}

/**
 * Windows compares names case-insensitively. Only ASCII letters are folded: a fuller folding
 * (`toLowerCase`) equates characters NTFS keeps apart (the Kelvin sign and `K`), which could pass
 * a folder outside the root as inside it. A non-ASCII name in another case is refused instead.
 */
function sameName(a: string, b: string, windows: boolean): boolean {
  if (!windows) return a === b
  const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase())
  return fold(a) === fold(b)
}

/**
 * The path, resolved, if it is one of the roots or inside one; `null` otherwise. It is spelt with
 * the root's own spelling followed by the rest of the path, with `/` separators, as the local
 * backend lists paths.
 *
 * Symbolic links and junctions are out of scope: a link inside a root that points outside it is
 * followed by whatever lists or opens the path. The Drive shows such links too.
 */
export function resolveAllowedPath(path: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    const windows = isWindowsForm(root)
    const parsedRoot = parsePath(root, windows)
    const parsed = parsePath(path, windows)
    if (parsedRoot == null || parsed == null) continue
    if (!sameName(parsed.prefix, parsedRoot.prefix, windows)) continue
    if (parsed.segments.length < parsedRoot.segments.length) continue
    const inside = parsedRoot.segments.every((segment, i) =>
      sameName(segment, parsed.segments[i]!, windows),
    )
    if (!inside) continue
    const below = parsed.segments.slice(parsedRoot.segments.length)
    return formatPath(
      { prefix: parsedRoot.prefix, segments: [...parsedRoot.segments, ...below] },
      windows,
    )
  }
  return null
}

/**
 * Whether the path is one of the roots or inside one, after resolving `.` and `..` and unifying
 * separators (and, on Windows, comparing ASCII letters case-insensitively). A relative or empty
 * path is never allowed. See {@link resolveAllowedPath}.
 */
export function isAllowedPath(path: string, roots: readonly string[]): boolean {
  return resolveAllowedPath(path, roots) != null
}

/** Whether two paths, both resolved against `root`'s form, name the same thing. */
export function samePath(a: string, b: string, root: string): boolean {
  const windows = isWindowsForm(root)
  const parsedA = parsePath(a, windows)
  const parsedB = parsePath(b, windows)
  if (parsedA == null || parsedB == null) return false
  return (
    sameName(parsedA.prefix, parsedB.prefix, windows) &&
    parsedA.segments.length === parsedB.segments.length &&
    parsedA.segments.every((segment, i) => sameName(segment, parsedB.segments[i]!, windows))
  )
}

/** The folder holding the path; `null` for a root of the filesystem. */
export function parentPath(path: string, root: string): string | null {
  const windows = isWindowsForm(root)
  const parsed = parsePath(path, windows)
  if (parsed == null || parsed.segments.length === 0) return null
  return formatPath({ prefix: parsed.prefix, segments: parsed.segments.slice(0, -1) }, windows)
}
