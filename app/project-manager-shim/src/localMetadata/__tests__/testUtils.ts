/** @file Helpers for `localMetadata` tests. */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** Create a minimal Enso project at `directory` and return its path. */
export async function createProject(
  directory: string,
  id: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  await fs.mkdir(path.join(directory, '.enso'), { recursive: true })
  await fs.writeFile(
    path.join(directory, 'package.yaml'),
    `name: ${path.basename(directory)}\nnamespace: local\n`,
  )
  await fs.writeFile(
    path.join(directory, '.enso', 'project.json'),
    JSON.stringify(
      { id, kind: 'UserProject', created: '2026-01-01T00:00:00.000Z', ...extra },
      null,
      2,
    ),
  )
  return directory
}

/** Read a project's `.enso/project.json`. */
export async function readProjectJson(directory: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(directory, '.enso', 'project.json'), 'utf8'))
}
