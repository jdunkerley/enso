/**
 * @file The `add_image` tool: stores an image in the project's `images` folder, for the
 * documentation, and answers the Markdown that shows it. The image is a file on the user's machine,
 * which main reads, or a picture of a node's visualization, taken as `get_visualization` takes it.
 * Main sends the bytes to the window handler `store_image`, which writes them through the same
 * functions as the documentation editor's upload. It does not import `electron`: the caller
 * supplies the capture and the file reader.
 *
 * Note [add_image Reads Only Images]: an agent names any path, and main reads it with the user's
 * rights, so the file is copied into the project only when its extension is an image kind AND its
 * leading bytes are that kind (an extension that does not match the content, such as a PNG named
 * `.jpg`, is refused too). It must be a regular file (after following symbolic links) of at most
 * {@link IMAGE_MAX_BYTES}, which is checked from its size before anything is read; no error ever
 * quotes the file's content. On Windows the path must be a drive path (`C:\...`): a network path
 * (`\\host\share`) would make `stat` connect, and authenticate, to that host, a device path
 * (`\\.\`, `\\?\`) reaches pipes and devices, and a further `:` names an alternate data stream
 * (`C:\notes.txt:x.png`), another file's hidden content. Only local files are taken: a drive
 * letter can be a mapped network drive, so on Windows the path is also resolved with the native
 * `realpath` (`GetFinalPathNameByHandle`), which turns `Z:\x.png` on a mapped drive into
 * `\\server\share\x.png`, and a result that is a network path is refused before `stat` or `open`
 * touch it. The same resolution catches a local junction or link whose target is a share. A drive
 * made with `subst` resolves to its local target and is accepted. If the resolution itself fails,
 * the file is refused (it cannot be shown to be local).
 *
 * For SVG only the start of the file is checked (an `<svg` element after the prologue), so a text
 * file that begins with `<svg` is copied whole. That is acceptable: such a file is one the agent
 * already controls the content of (nothing of the user's is revealed by copying it), and the
 * documentation panel shows it in an `<img>`, which runs no script and loads nothing external.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { constants as fsConstants, realpath as realpathCallback } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import { pictureVisualization, sleepFor, type Capture } from './visualizationTool'
import { EDIT_TOOL_TIMEOUT_MS, type WindowBridge } from './windowBridge'

/** `fs.realpath.native`: the OS's own resolution, which sees through a mapped network drive. */
const realpathNative = promisify(realpathCallback.native)

export const IMAGE_TOOL_NAME = 'add_image'
/** Most bytes of an image, read from a file or sent to the window. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** Most characters of `path`. */
const PATH_CHARS = 1_000
/** Most characters of `name`. */
const IMAGE_NAME_CHARS = 100
/** Most characters of a node id, as `get_visualization` takes it. */
const NODE_ID_CHARS = 200
/** Most bytes of an AVIF file's `ftyp` box that are searched for its brand. */
const FTYP_SCAN_BYTES = 256

/** The characters a stored name may have. */
const NAME_PATTERN = /^[A-Za-z0-9._ -]+$/
/** A name needs one of these: not only dots and spaces. */
const NAME_SUBSTANCE = /[A-Za-z0-9_-]/
/** Names Windows gives to devices, with any extension: `NUL.png` is the device on Windows. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** An image kind: the extensions it is stored under and the check of its content. */
interface ImageKind {
  /** With its article, as a sentence names it: "a PNG". */
  readonly label: string
  readonly extensions: readonly string[]
  readonly matches: (bytes: Buffer) => boolean
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.length >= end ? bytes.toString('latin1', start, end) : ''
}

/** An ISO BMFF `ftyp` box whose major or a compatible brand is AVIF's (`avif`, `avis`). */
function isAvif(bytes: Buffer): boolean {
  if (ascii(bytes, 4, 8) !== 'ftyp') return false
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length, FTYP_SCAN_BYTES)
  const brands = [ascii(bytes, 8, 12)]
  for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(ascii(bytes, at, at + 4))
  return brands.some((brand) => brand === 'avif' || brand === 'avis')
}

/**
 * Text whose first content, after an optional byte order mark and XML declaration and any comments
 * or an SVG document type (without an internal subset), is an `<svg` element.
 */
function isSvg(bytes: Buffer): boolean {
  const text = bytes.toString('utf8')
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at]!)) at += 1
  }
  skipSpace()
  if (text.startsWith('<?xml', at)) {
    const end = text.indexOf('?>', at)
    if (end < 0) return false
    at = end + 2
  }
  for (;;) {
    skipSpace()
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4)
      if (end < 0) return false
      at = end + 3
    } else if (text.startsWith('<!DOCTYPE', at)) {
      const end = text.indexOf('>', at)
      if (end < 0) return false
      const declaration = text.slice(at, end)
      if (!/^<!DOCTYPE\s+svg(\s|$)/.test(declaration) || declaration.includes('[')) return false
      at = end + 1
    } else {
      break
    }
  }
  return /^<svg[\s/>]/.test(text.slice(at, at + 5))
}

/** The kinds `add_image` accepts: the documentation editor's list (`asyncResources/upload.ts`). */
const IMAGE_KINDS: readonly ImageKind[] = [
  {
    label: 'a PNG',
    extensions: ['png', 'apng'],
    matches: (bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE),
  },
  {
    label: 'a JPEG',
    extensions: ['jpg', 'jpeg'],
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    label: 'a GIF',
    extensions: ['gif'],
    matches: (bytes) => ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6)),
  },
  {
    label: 'a WebP',
    extensions: ['webp'],
    matches: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP',
  },
  { label: 'an AVIF', extensions: ['avif'], matches: isAvif },
  { label: 'an SVG', extensions: ['svg'], matches: isSvg },
]
const PNG_KIND = IMAGE_KINDS[0]!
const ALL_EXTENSIONS = IMAGE_KINDS.flatMap((kind) => kind.extensions)

function kindOfExtension(extension: string): ImageKind | undefined {
  return IMAGE_KINDS.find((kind) => kind.extensions.includes(extension))
}

/** A file's kind and size, as `fs.stat` gives them. */
export interface ImageFileStat {
  isFile(): boolean
  readonly size: number
}

/** How `add_image` reads a file; {@link fsImageFiles} outside tests. */
export interface ImageFiles {
  /**
   * The path with every link and mapped drive resolved (native `realpath`). Called on Windows
   * only; a result that starts with two backslashes is a network path.
   */
  resolve?(path: string): Promise<string>
  /** The file's kind and size, following symbolic links. */
  stat(path: string): Promise<ImageFileStat>
  /**
   * The file's bytes, at most `maxBytes + 1` of them: more than `maxBytes` means the file is
   * larger than that. Rejects anything that is not a regular file.
   */
  read(path: string, maxBytes: number): Promise<Buffer>
}

/**
 * The file reader `add_image` uses: `stat` follows symbolic links; `read` resolves them first
 * (`realpath`), opens the target without following a link and without blocking (`O_NOFOLLOW`,
 * `O_NONBLOCK`, where the platform has them), checks that what it opened is a regular file, and
 * reads at most one byte past the limit, so a file that grew after `stat` is never read whole.
 */
export function fsImageFiles(): ImageFiles {
  return {
    resolve: (path) => realpathNative(path),
    stat: (path) => stat(path),
    read: async (path, maxBytes) => {
      // Native, so that a mapped network drive resolves to its `\\server\share` form here too.
      const target = await realpathNative(path)
      if (process.platform === 'win32' && isNetworkPath(target)) throw new NetworkPathError()
      const flags =
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
      const handle = await open(target, flags)
      try {
        if (!(await handle.stat()).isFile()) throw new NotRegularFileError()
        const chunks: Buffer[] = []
        let total = 0
        while (total <= maxBytes) {
          const chunk = Buffer.alloc(Math.min(1024 * 1024, maxBytes + 1 - total))
          const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
          if (bytesRead === 0) break
          chunks.push(chunk.subarray(0, bytesRead))
          total += bytesRead
        }
        return Buffer.concat(chunks, total)
      } finally {
        await handle.close()
      }
    },
  }
}

/** Whether a resolved Windows path is on the network (`\\server\share\…`) or a device. */
export function isNetworkPath(resolved: string): boolean {
  return resolved.startsWith('\\\\') || resolved.startsWith('//')
}

/** The file is on a network drive. */
class NetworkPathError extends Error {
  /** The error's code, as Node's file errors have one. */
  readonly code = 'ENETWORKPATH'
  constructor() {
    super('Network path')
  }
}

/** What was opened is not a regular file (a symbolic link replaced after `stat`, a device). */
class NotRegularFileError extends Error {
  /** The error's code, as Node's file errors have one. */
  readonly code = 'ENOTREGULAR'
  constructor() {
    super('Not a regular file')
  }
}

const NOT_REGULAR_ERROR =
  'The path is not a regular file (a folder or a device). Give the path of an image file.'
const TOO_LARGE_ERROR = 'The file is larger than 10 MB, the most `add_image` stores.'

/** A sentence for a failed `stat` or read; never the file's content. */
function readError(error: unknown): string {
  const code = error != null && typeof error === 'object' && 'code' in error ? error.code : null
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return 'There is no file at that path. Give the absolute path of an image file.'
    case 'EACCES':
    case 'EPERM':
      return 'The file could not be read: permission denied.'
    case 'ENETWORKPATH':
      return NETWORK_DRIVE_ERROR
    case 'EISDIR':
    case 'ENOTREGULAR':
    case 'ELOOP':
      return NOT_REGULAR_ERROR
    default:
      return 'The file could not be read.'
  }
}

/** The refusal for a `name` that breaks the naming rule, or null when it is fine. */
function nameError(name: string): string | null {
  if (/[/\\]/.test(name)) return 'The `name` is a file name, without folders.'
  if (!NAME_PATTERN.test(name)) {
    return (
      'The `name` may contain only letters A-Z and a-z, digits, spaces and the characters ' +
      '`.`, `_` and `-`.'
    )
  }
  if (!NAME_SUBSTANCE.test(name)) return 'The `name` must contain a letter, a digit, `_` or `-`.'
  if (RESERVED_NAME.test(name)) {
    return 'The `name` is one Windows reserves for a device (such as CON or NUL); choose another.'
  }
  return null
}

/**
 * `name` with an extension of `kind`: kept when it has one, else `extension` replaces an image
 * extension of another kind or is appended.
 */
function withKindExtension(name: string, kind: ImageKind, extension: string): string {
  const dot = name.lastIndexOf('.')
  const current = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (kind.extensions.includes(current)) return name
  const stem = dot > 0 && ALL_EXTENSIONS.includes(current) ? name.slice(0, dot) : name
  return `${stem}.${extension}`
}

/**
 * The source file's name as a stored name: characters outside the rule become `_`, the stem is
 * cut to fit {@link IMAGE_NAME_CHARS}, and a name with nothing left (or a device's) gets a stem.
 */
function nameFromSource(fileName: string, extension: string): string {
  const stem = fileName
    .slice(0, fileName.length - extension.length - 1)
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, IMAGE_NAME_CHARS - extension.length - 1)
  const name = `${stem}.${extension}`
  if (!NAME_SUBSTANCE.test(stem)) return `image.${extension}`
  return RESERVED_NAME.test(name) ? `_${name}` : name
}

type Loaded = { ok: true; bytes: Buffer; name: string } | { ok: false; error: string }

const NOT_LOCAL_ERROR =
  'Give the full path of a file on this computer, such as C:\\charts\\sales.png; network and ' +
  'device paths are not accepted.'
const NETWORK_DRIVE_ERROR =
  'The file is on a network drive. `add_image` stores only files on a local disk: copy the ' +
  'image to a local disk and give that path.'
const RELATIVE_ERROR = 'The `path` must be absolute: the full path of an image file.'

/**
 * Why `path` is not taken, or null. On Windows only a drive path (`C:\` or `C:/`), which by its
 * first characters refuses network (`\\host\share`, `//host/share`), device (`\\.\`, `\\?\`),
 * drive-relative (`C:x`) and driveless (`\charts`) paths, and with no other `:`, which refuses
 * alternate data streams. Elsewhere any absolute path.
 */
function pathError(path: string, platform: NodeJS.Platform): string | null {
  if (platform === 'win32') {
    // A `:` after the drive names an alternate data stream (`C:\a.txt:x.png`), another file's
    // hidden content.
    return /^[A-Za-z]:[\\/]/.test(path) && !path.includes(':', 2) ? null : NOT_LOCAL_ERROR
  }
  return posix.isAbsolute(path) ? null : RELATIVE_ERROR
}

/** Reads the image at `path`, refusing anything Note [add_image Reads Only Images] rules out. */
async function loadImageFile(
  files: ImageFiles,
  path: string,
  name: string | undefined,
  platform: NodeJS.Platform,
): Promise<Loaded> {
  const refusal = pathError(path, platform)
  if (refusal != null) return { ok: false, error: refusal }
  if (platform === 'win32' && files.resolve != null) {
    try {
      if (isNetworkPath(await files.resolve(path))) return { ok: false, error: NETWORK_DRIVE_ERROR }
    } catch (error) {
      return { ok: false, error: readError(error) }
    }
  }
  const paths = platform === 'win32' ? win32 : posix
  const fileName = paths.basename(path)
  const extension = paths.extname(fileName).slice(1).toLowerCase()
  const kind = kindOfExtension(extension)
  if (kind == null) {
    return {
      ok: false,
      error: `The file's extension must be one of ${ALL_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
    }
  }
  let bytes: Buffer
  try {
    const info = await files.stat(path)
    if (!info.isFile()) return { ok: false, error: NOT_REGULAR_ERROR }
    if (info.size > IMAGE_MAX_BYTES) return { ok: false, error: TOO_LARGE_ERROR }
    bytes = await files.read(path, IMAGE_MAX_BYTES)
  } catch (error) {
    return { ok: false, error: readError(error) }
  }
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, error: TOO_LARGE_ERROR }
  if (!kind.matches(bytes)) {
    const actual = IMAGE_KINDS.find((other) => other.matches(bytes))
    return {
      ok: false,
      error:
        `The file is not ${kind.label} image, as its extension says` +
        (actual != null ?
          `: its content is ${actual.label} image. Rename it with a matching extension and try again.`
        : ': its content is not an image of that kind, so it was not copied.'),
    }
  }
  const ownExtension = paths.extname(fileName).slice(1)
  return {
    ok: true,
    bytes,
    name:
      name != null ?
        withKindExtension(name, kind, extension)
      : nameFromSource(fileName, ownExtension),
  }
}

const SHOWN_NOTE =
  " The node's visualization was shown for the picture; hide it again with `set_visualization` " +
  'if the user did not ask to see it.'

/**
 * The `add_image` tool over the window (`bridge`), a way to photograph it (as for
 * `get_visualization`) and a way to read files. `sleep` is the wait between captures (instant in
 * tests); `platform` decides which paths are taken (injected in tests, to cover both rules).
 */
export function imageTool(
  bridge: Pick<WindowBridge, 'call'>,
  capture: Capture,
  files: ImageFiles,
  sleep: (ms: number) => Promise<void> = sleepFor,
  platform: NodeJS.Platform = process.platform,
): ToolDefinition {
  return {
    name: IMAGE_TOOL_NAME,
    title: 'Add an image to the project',
    description:
      "Store an image in the project's `images` folder, to show in the documentation. Give " +
      "exactly one of `path`, the absolute path of an image file on the user's machine (it " +
      'need not be in the Drive: your own chart is fine), or `node_id` (from `get_graph`), for ' +
      "a picture of that node's visualization, taken as `get_visualization` takes it and " +
      'stored as PNG. A file must be a regular file of at most 10 MB whose extension is ' +
      '.png, .apng, .jpg, .jpeg, .gif, .webp, .avif or .svg and whose content is that kind ' +
      'of image; anything else is refused and nothing is copied. `name` (optional) is the ' +
      'file name to store under, without folders: letters A-Z and a-z, digits, spaces, `.`, ' +
      "`_` and `-`; its extension is set to match the image. By default the source file's " +
      "name, or the node's name for a picture. An image never replaces another: a name " +
      'already taken gets a number. Returns `{ path, markdown, bytes }` (plus `shown` and ' +
      '`moved` for a picture, as `get_visualization` gives them): put `markdown` into the ' +
      'text you send to `set_documentation`; this tool does not change the documentation. ' +
      'Storing an image is not an edit: it is not on the undo stack, and an image that ends ' +
      'up unused stays in the `images` folder for the user to delete. A `path` works in Live ' +
      'mode; a picture follows the Live rules of `get_visualization` (it may show a hidden ' +
      'visualization and move the view, as that tool does).',
    inputSchema: {
      path: z.string().min(1).max(PATH_CHARS).optional(),
      node_id: z.string().max(NODE_ID_CHARS).optional(),
      name: z.string().min(1).max(IMAGE_NAME_CHARS).optional(),
    },
    run: async (args, caller: McpCaller): Promise<McpToolResult> => {
      const path = typeof args.path === 'string' ? args.path : undefined
      const nodeId = typeof args.node_id === 'string' ? args.node_id : undefined
      const name = typeof args.name === 'string' ? args.name : undefined
      if ((path == null) === (nodeId == null)) {
        return {
          ok: false,
          error:
            'Give exactly one of `path` (an image file) and `node_id` (a node whose ' +
            'visualization to picture).',
        }
      }
      if (name != null) {
        const error = nameError(name)
        if (error != null) return { ok: false, error }
      }
      if (path != null) {
        const loaded = await loadImageFile(files, path, name, platform)
        if (!loaded.ok) return loaded
        return bridge.call(
          'store_image',
          { data: loaded.bytes.toString('base64'), name: loaded.name },
          caller,
          EDIT_TOOL_TIMEOUT_MS,
        )
      }
      const picture = await pictureVisualization(
        bridge,
        capture,
        sleep,
        { node_id: nodeId },
        caller,
      )
      if (!picture.ok) return picture
      const { shown, moved } = picture.value.about
      const stored = await bridge.call(
        'store_image',
        {
          data: picture.value.png.toString('base64'),
          // Without a name the window names it after the node, which only it knows.
          ...(name != null ?
            { name: withKindExtension(name, PNG_KIND, 'png') }
          : { node_id: nodeId }),
          // The window refuses when another project is on screen by now.
          ...(picture.value.projectId != null ? { project_id: picture.value.projectId } : {}),
        },
        caller,
        EDIT_TOOL_TIMEOUT_MS,
      )
      if (!stored.ok) return shown ? { ok: false, error: stored.error + SHOWN_NOTE } : stored
      let value: unknown
      try {
        value = JSON.parse(stored.value)
      } catch {
        value = null
      }
      if (value == null || typeof value !== 'object') {
        return { ok: false, error: 'The Enso window did not say where it stored the image.' }
      }
      return { ok: true, value: JSON.stringify({ ...value, shown, moved }, null, 1) }
    },
  }
}
