/**
 * @file Which path the Logs panel may reveal in the OS file manager.
 *
 * The renderer names the file, so main checks it before `shell.showItemInFolder`: only an existing
 * file under the engine log directory is shown. A UNC path is refused outright: on Windows, merely
 * touching `\\host\share` makes the OS authenticate to that host, which can leak NTLM credentials.
 * The drive's "Open in Explorer" keeps its own, unconstrained channel (`showItemInFolder`), since it
 * reveals project files anywhere.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

/** What the check reads from the file system; tests pass fakes. */
export interface RevealFileSystem {
  /** The canonical path (symbolic links and `..` resolved), or throw if there is nothing there. */
  readonly realpath: (target: string) => string
  /** Whether `target` is a regular file. */
  readonly isFile: (target: string) => boolean
}

const NODE_FILE_SYSTEM: RevealFileSystem = {
  realpath: (target) => fs.realpathSync.native(target),
  isFile: (target) => fs.statSync(target).isFile(),
}

/** Why a path was refused, for the warning. */
export type RevealRefusal = 'not-a-string' | 'unc' | 'missing' | 'not-a-file' | 'outside'

/** The outcome of {@link resolveLogFileToReveal}. */
export type RevealDecision =
  | { readonly ok: true; readonly file: string }
  | { readonly ok: false; readonly reason: RevealRefusal }

/** Whether `target` is a UNC path (`\\host\share`, `//host/share`, `\\?\UNC\…`). */
function isUncPath(target: string): boolean {
  return /^[\\/]{2}/.test(target)
}

/**
 * Whether `child` is `parent` or inside it, compared as real paths, case-insensitively on Windows
 * (and macOS's default file system is case-insensitive too, so it is compared the same way there).
 */
function isInside(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const fold = platform === 'win32' || platform === 'darwin'
  const a = fold ? parent.toLowerCase() : parent
  const b = fold ? child.toLowerCase() : child
  const relative = paths.relative(a, b)
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative)
}

/**
 * The file to reveal for a request from the renderer, or why not: `requested` must be an existing
 * regular file under `logDirectory` once both are resolved to real paths, and not a UNC path.
 */
export function resolveLogFileToReveal(
  requested: unknown,
  logDirectory: string,
  options: {
    readonly platform?: NodeJS.Platform
    readonly fileSystem?: RevealFileSystem
  } = {},
): RevealDecision {
  const platform = options.platform ?? process.platform
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM
  if (typeof requested !== 'string' || requested === '' || requested.includes('\0')) {
    return { ok: false, reason: 'not-a-string' }
  }
  if (isUncPath(requested) || isUncPath(logDirectory)) return { ok: false, reason: 'unc' }
  const paths = platform === 'win32' ? path.win32 : path.posix
  let file: string
  let directory: string
  try {
    file = fileSystem.realpath(paths.resolve(requested))
    directory = fileSystem.realpath(paths.resolve(logDirectory))
  } catch {
    return { ok: false, reason: 'missing' }
  }
  // A link inside the directory could still point at a share.
  if (isUncPath(file)) return { ok: false, reason: 'unc' }
  if (!isInside(directory, file, platform)) return { ok: false, reason: 'outside' }
  try {
    if (!fileSystem.isFile(file)) return { ok: false, reason: 'not-a-file' }
  } catch {
    return { ok: false, reason: 'missing' }
  }
  return { ok: true, file }
}
