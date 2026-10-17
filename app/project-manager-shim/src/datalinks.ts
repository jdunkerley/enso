/**
 * @file Local datalinks: `<name>.datalink` files holding a datalink's JSON, the format the standard
 * library reads with `Data.read`. Writes go through a temporary file renamed into place
 * (`writeJsonAtomic`), serialised per path, as `package.yaml` and `project.json` writes are.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { errorCode, isRecord, serialised, writeJsonAtomic } from './localMetadata/jsonFile.js'

/** The extension of a datalink file. The standard library compares it case-sensitively. */
export const DATALINK_EXTENSION = '.datalink'

/** Whether `filePath` names a datalink file: a non-empty name ending in exactly `.datalink`. */
export function isDatalinkPath(filePath: string): boolean {
  const name = path.basename(filePath)
  return name.length > DATALINK_EXTENSION.length && name.endsWith(DATALINK_EXTENSION)
}

function requireDatalinkPath(filePath: string): void {
  if (!path.isAbsolute(filePath) || !isDatalinkPath(filePath)) {
    throw new Error(`'${filePath}' is not an absolute path to a '${DATALINK_EXTENSION}' file.`)
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
 * @throws {Error} when the file is missing, or is not valid JSON (the file is left as it is).
 */
export async function readDatalink(filePath: string): Promise<unknown> {
  requireDatalinkPath(filePath)
  const text = await fs.readFile(filePath, 'utf8')
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
    if ((await statOrNull(filePath)) != null) {
      throw new Error(`'${path.basename(filePath)}' already exists.`)
    }
    await writeJsonAtomic(filePath, value)
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
    await writeJsonAtomic(filePath, value)
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
