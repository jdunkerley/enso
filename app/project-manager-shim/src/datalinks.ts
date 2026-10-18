/**
 * @file Local datalinks: `<name>.datalink` files holding a datalink's JSON, the format the standard
 * library reads with `Data.read`. Writes go through a temporary file renamed into place
 * (`writeJsonAtomic`), serialised per path, as `package.yaml` and `project.json` writes are.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  errorCode,
  isRecord,
  serialised,
  writeJsonAtomic,
  writeJsonExclusive,
} from './localMetadata/jsonFile.js'

/** The extension of a datalink file. The standard library compares it case-sensitively. */
export const DATALINK_EXTENSION = '.datalink'

/** Whether `filePath` names a datalink file: a non-empty name ending in exactly `.datalink`. */
export function isDatalinkPath(filePath: string): boolean {
  const name = path.basename(filePath)
  return name.length > DATALINK_EXTENSION.length && name.endsWith(DATALINK_EXTENSION)
}

/** The part of `pathModule`'s syntax this rule depends on: Windows or POSIX. */
type PathModule = Pick<typeof path, 'isAbsolute' | 'parse' | 'basename' | 'sep'>

/**
 * Whether `filePath` is an absolute path to a `.datalink` file with no `.` or `..` segment and no
 * empty interior segment (`a//b`). Either separator is accepted on Windows, as the GUI sends
 * forward-slash paths; a rooted path without a drive letter or UNC share (`\\a\\x.datalink`)
 * is not absolute there. Datalinks live in any folder the user picks, so there is no root to
 * confine them to. `pathModule` is a parameter so the Windows rules can be tested anywhere.
 */
export function isAcceptableDatalinkPath(filePath: string, pathModule: PathModule = path): boolean {
  const windows = pathModule.sep === '\\'
  if (!pathModule.isAbsolute(filePath)) return false
  const { root } = pathModule.parse(filePath)
  if (windows && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(root)) return false
  const segments = filePath.slice(root.length).split(windows ? /[\\/]/ : '/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false
  }
  const name = pathModule.basename(filePath)
  return name.length > DATALINK_EXTENSION.length && name.endsWith(DATALINK_EXTENSION)
}

function requireDatalinkPath(filePath: string): void {
  if (!isAcceptableDatalinkPath(filePath)) {
    throw new Error(
      `'${filePath}' is not an absolute path to a '${DATALINK_EXTENSION}' file without '.' or '..' segments.`,
    )
  }
}

function requireObject(value: unknown): void {
  if (!isRecord(value)) throw new Error('A datalink must be a JSON object.')
}

async function statOrNull(filePath: string) {
  try {
    return await fs.stat(filePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

/**
 * The parsed JSON of the datalink file. It is not checked against the datalink schema: the GUI's
 * editor validates what it shows.
 * @throws {Error} when the file is missing (`Datalink not found`), or is not valid JSON (the file is left as it is).
 */
export async function readDatalink(filePath: string): Promise<unknown> {
  requireDatalinkPath(filePath)
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new Error(`Datalink not found: '${filePath}'.`, { cause: error })
    }
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`'${path.basename(filePath)}' is not valid JSON: ${reason}`, { cause: error })
  }
}

/**
 * Create a datalink file in an existing folder.
 * @throws {Error} when the file already exists, or its folder does not.
 */
export async function createDatalink(filePath: string, value: unknown): Promise<void> {
  requireDatalinkPath(filePath)
  requireObject(value)
  return await serialised(filePath, async () => {
    const folder = path.dirname(filePath)
    if (!(await statOrNull(folder))?.isDirectory()) {
      throw new Error(`The folder '${folder}' does not exist.`)
    }
    try {
      await writeJsonExclusive(filePath, value)
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new Error(`'${path.basename(filePath)}' already exists.`, { cause: error })
      }
      throw error
    }
  })
}

/**
 * Replace the content of an existing datalink file.
 * @throws {Error} when the file does not exist.
 */
export async function updateDatalink(filePath: string, value: unknown): Promise<void> {
  requireDatalinkPath(filePath)
  requireObject(value)
  return await serialised(filePath, async () => {
    if (!(await statOrNull(filePath))?.isFile()) {
      throw new Error(`'${path.basename(filePath)}' does not exist.`)
    }
    // Write through a symlink rather than replacing it with a regular file.
    await writeJsonAtomic(await fs.realpath(filePath), value)
  })
}

/**
 * Delete a datalink file.
 * @throws {Error} when the path is not a file.
 */
export async function deleteDatalink(filePath: string): Promise<void> {
  requireDatalinkPath(filePath)
  return await serialised(filePath, async () => {
    if (!(await statOrNull(filePath))?.isFile()) {
      throw new Error(`'${path.basename(filePath)}' is not a file.`)
    }
    await fs.rm(filePath)
  })
}
