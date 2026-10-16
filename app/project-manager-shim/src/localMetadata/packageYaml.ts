/** @file Read and write project labels in `package.yaml`. */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'yaml'
import {
  PACKAGE_METADATA_RELATIVE_PATH,
  PROJECT_METADATA_RELATIVE_PATH,
} from '../projectManagement.js'
import { isRecord, readJson, renameWithRetry, updateJsonFile } from './jsonFile.js'

/**
 * The `labels` list of the `package.yaml` in `projectPath`; `[]` when absent or
 * malformed.
 */
export async function readPackageLabels(projectPath: string): Promise<string[]> {
  const filePath = path.join(projectPath, PACKAGE_METADATA_RELATIVE_PATH)
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return []
  }

  try {
    const doc = yaml.parseDocument(text)
    const jsValue = doc.toJS()
    if (!jsValue || typeof jsValue !== 'object' || !('labels' in jsValue)) {
      return []
    }
    const labels = jsValue.labels
    if (!Array.isArray(labels)) return []
    return labels.filter((label) => typeof label === 'string')
  } catch {
    return []
  }
}

/**
 * Replace the `labels` list in `projectPath`'s `package.yaml`, keeping every
 * other key, its order and comments. An empty list removes the key.
 * @throws {Error} when the file is missing, has YAML syntax errors (it is left untouched), or is
 * not a YAML mapping.
 */
export async function writePackageLabels(
  projectPath: string,
  labels: readonly string[],
): Promise<void> {
  const filePath = path.join(projectPath, PACKAGE_METADATA_RELATIVE_PATH)
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Cannot read package.yaml: ${String(error)}`, { cause: error })
  }

  const doc = yaml.parseDocument(text)
  if (doc.errors.length > 0) {
    throw new Error(`Refusing to rewrite '${filePath}': ${doc.errors[0]?.message}`)
  }
  if (!doc.contents || !yaml.isMap(doc.contents)) {
    throw new Error(`'${filePath}' is not a YAML mapping`)
  }

  if (labels.length === 0) {
    doc.delete('labels')
  } else {
    doc.set('labels', labels)
  }

  const newText = doc.toString({ indentSeq: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await fs.writeFile(tempPath, newText)
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}

/**
 * The project's label names, from `package.yaml`. Labels still in `.enso/project.json` (written
 * before labels moved) are moved into `package.yaml` first; when both have labels,
 * `package.yaml`'s win. `project.json` loses its `labels` either way.
 * @throws {Error} when labels have to be moved and `package.yaml` cannot be rewritten.
 */
export async function readProjectLabels(projectPath: string): Promise<string[]> {
  const projectJsonPath = path.join(projectPath, PROJECT_METADATA_RELATIVE_PATH)
  let current: unknown
  try {
    current = await readJson(projectJsonPath)
  } catch {
    // A corrupt `project.json` is never touched: that would cost the project its UUID.
    return readPackageLabels(projectPath)
  }
  if (!isRecord(current) || !('labels' in current)) return readPackageLabels(projectPath)

  await updateJsonFile(projectJsonPath, async (latest) => {
    if (!isRecord(latest)) return latest
    const { labels, ...rest } = latest
    if (Array.isArray(labels) && (await readPackageLabels(projectPath)).length === 0) {
      const legacy = labels.filter((label): label is string => typeof label === 'string')
      if (legacy.length > 0) await writePackageLabels(projectPath, legacy)
    }
    return rest
  })
  return readPackageLabels(projectPath)
}

/**
 * The label names still in `.enso/project.json`, ignoring anything malformed; `[]` when the file
 * is missing, unreadable or has none. Reads only.
 */
export async function readLegacyProjectLabels(projectPath: string): Promise<string[]> {
  try {
    const json = await readJson(path.join(projectPath, PROJECT_METADATA_RELATIVE_PATH))
    if (!isRecord(json) || !Array.isArray(json.labels)) return []
    return json.labels.filter((label): label is string => typeof label === 'string')
  } catch {
    return []
  }
}
