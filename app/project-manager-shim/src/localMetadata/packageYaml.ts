/** @file Read and write project labels in `package.yaml`. */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'yaml'

/**
 * The `labels` list of the `package.yaml` in `projectPath`; `[]` when absent or
 * malformed.
 */
export async function readPackageLabels(projectPath: string): Promise<string[]> {
  const filePath = path.join(projectPath, 'package.yaml')
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
 * @throws {Error} when the file is missing or is not a YAML mapping.
 */
export async function writePackageLabels(
  projectPath: string,
  labels: readonly string[],
): Promise<void> {
  const filePath = path.join(projectPath, 'package.yaml')
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Cannot read package.yaml: ${String(error)}`, { cause: error })
  }

  const doc = yaml.parseDocument(text)
  if (!doc.contents || !yaml.isMap(doc.contents)) {
    throw new Error('package.yaml is not a YAML mapping')
  }

  if (labels.length === 0) {
    doc.delete('labels')
  } else {
    doc.set('labels', labels)
  }

  const newText = doc.toString({ indentSeq: true })
  const tempPath = `${filePath}.tmp-${process.pid}`
  try {
    await fs.writeFile(tempPath, newText)
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}
