/**
 * @file The window handler `store_image`, which main's `add_image` tool calls (it is not an MCP tool
 * itself): it writes an image main has read or captured into the project's `images` folder,
 * through the same project file functions as the documentation editor's upload
 * (`providers/asyncResources/upload.ts`): the folder is created when missing, `pickUniqueName`
 * picks a name no file has, and `writeFileBinary` writes it. It answers the URL the editor writes
 * and the Markdown that shows the image. Storing a file is not a module edit: nothing joins the
 * undo stack, and it works in Live mode.
 */
import type { ProjectFiles } from '@/stores/projectFiles'
import type { McpToolResult } from 'enso-common/src/mcp'
import { toolError } from './editTools'
import { jsonResult } from './graphTools'

/** The project folder images are stored in, as the documentation editor's upload stores them. */
export const IMAGES_FOLDER = 'images'
/** Most bytes of a stored image (main's `IMAGE_MAX_BYTES`). */
export const STORED_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** The extensions `add_image` stores under: the documentation editor's list. */
const IMAGE_EXTENSIONS = ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']
/** Main's naming rule, checked again: a name is one path segment of these characters. */
const NAME_PATTERN = /^[A-Za-z0-9._ -]+$/
const NAME_SUBSTANCE = /[A-Za-z0-9_-]/
/** Names Windows gives to devices, with any extension: `NUL.png` is the device there. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

const TIMED_OUT_ERROR =
  'The call timed out before the image was stored. Nothing was stored; try again.'

/** What `store_image` reads and does. */
export interface ImageToolDeps {
  /** The project's file functions (`useProjectFiles`). */
  readonly files: Pick<
    ProjectFiles,
    'projectRootId' | 'ensureDirExists' | 'pickUniqueName' | 'writeFileBinary'
  >
  /** The name of the node's binding; undefined when it has none or there is no such node. */
  readonly nodeName: (nodeId: string) => string | undefined
  readonly now: () => number
  /** When main stops waiting for the answer: nothing is written after it. */
  readonly deadline: number
}

/** `store_image`'s arguments: the bytes as base64, and the name or the node to name it after. */
export interface StoreImageArgs {
  readonly data: string
  readonly name?: string
  readonly node_id?: string
}

/** The name an image of the node's visualization is stored under when the agent gave none. */
function nameForNode(nodeName: string | undefined): string {
  const stem = (nodeName ?? '').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100)
  if (!NAME_SUBSTANCE.test(stem)) return 'visualization.png'
  const name = `${stem}.png`
  return RESERVED_NAME.test(name) ? `_${name}` : name
}

/** Whether `name` is a single file name under main's rule, with an image extension. */
function isSafeName(name: string): boolean {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return (
    NAME_PATTERN.test(name) &&
    NAME_SUBSTANCE.test(name) &&
    !RESERVED_NAME.test(name) &&
    name.includes('.') &&
    IMAGE_EXTENSIONS.includes(extension)
  )
}

/** The bytes `data` encodes, or why it cannot be stored: not base64, or more than the limit. */
function decodeBase64(data: string): Uint8Array<ArrayBuffer> | 'invalid' | 'too large' {
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) return 'invalid'
  const padding =
    data.endsWith('==') ? 2
    : data.endsWith('=') ? 1
    : 0
  if ((data.length / 4) * 3 - padding > STORED_IMAGE_MAX_BYTES) return 'too large'
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

/** The documentation editor's alternative text: the name without its extension, `[` `]` as `_`. */
export function altText(name: string): string {
  return name.replace(/\.([^.]+)$/, '').replace(/[[\]]/g, '_')
}

/**
 * `store_image`: writes the image to the project's `images` folder under `name` (or, without one,
 * `<node name>.png`, `visualization.png` when the node has no name), or under a numbered variant
 * when that name is taken, so no file is ever replaced. Answers `{ path, markdown, bytes }`: the
 * project-relative URL the documentation editor writes, `![<alt>](<path>)`, and the size.
 */
export async function storeImage(
  deps: ImageToolDeps,
  args: StoreImageArgs,
): Promise<McpToolResult> {
  const name =
    args.name ?? nameForNode(args.node_id != null ? deps.nodeName(args.node_id) : undefined)
  if (!isSafeName(name)) {
    return toolError('The image name must be one file name with an image extension.')
  }
  const bytes = decodeBase64(args.data)
  if (bytes === 'invalid') return toolError('The image data is not base64.')
  if (bytes === 'too large') return toolError('The image is larger than 10 MB.')
  const rootId = await deps.files.projectRootId
  if (rootId == null) return toolError('The project has no file tree to store the image in.')
  const folder = { rootId, segments: [IMAGES_FOLDER] }
  const exists = await deps.files.ensureDirExists(folder)
  if (!exists.ok) return toolError(exists.error.message('Could not create the images folder'))
  const unique = await deps.files.pickUniqueName(folder, name)
  if (!unique.ok) return toolError(unique.error.message('Could not list the images folder'))
  if (deps.now() >= deps.deadline) return toolError(TIMED_OUT_ERROR)
  const segments = [IMAGES_FOLDER, unique.value]
  const written = await deps.files.writeFileBinary({ rootId, segments }, new Blob([bytes]))
  if (!written.ok) return toolError(written.error.message('Could not write the image'))
  // As the editor's upload writes the URL (`uploadResourceToProject`).
  const path = `/${segments.map(encodeURI).join('/')}`
  return jsonResult({ path, markdown: `![${altText(unique.value)}](${path})`, bytes: bytes.length })
}

/**
 * Runs the calls one at a time: a second store of the same name picks its name only after the
 * first was written, so both cannot pick the same free name.
 */
export function serialized<A extends unknown[], R>(
  f: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve()
  return (...args) => {
    const next = last.then(() => f(...args))
    last = next.catch(() => {})
    return next
  }
}
