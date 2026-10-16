import * as fs from 'node:fs/promises'
import type * as http from 'node:http'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { withTempRepo, writeFiles } from '../../localVersioning/__tests__/testRepo.js'
import { LocalVersioning } from '../../localVersioning/index.js'
import { handleFilesystemCommand } from '../filesystem.js'

const REQUEST = {} as http.IncomingMessage
const git = (cwd: string, ...args: string[]) =>
  runCommand('git', args, { cwd }).then(({ stdout }) => stdout.trim())

async function move(from: string, to: string, versioning: LocalVersioning): Promise<void> {
  const response = await handleFilesystemCommand(
    ['--filesystem-move-from', from, '--filesystem-move-to', to],
    REQUEST,
    undefined,
    versioning,
  )
  expect(JSON.parse(response as string)).toHaveProperty('result')
}

describe('filesystem-move of a project directory', () => {
  test('commits the removal and the addition with a message naming the new path', async () => {
    await withTempRepo(async (root) => {
      const versioning = new LocalVersioning()
      await writeFiles(root, { 'A/package.yaml': 'name: A\n', 'A/src/Main.enso': 'main = 1\n' })
      await fs.mkdir(path.join(root, 'folder'))
      await versioning.init(root)
      await git(root, 'config', 'user.name', 'Tester')
      await git(root, 'config', 'user.email', 'tester@example.com')
      await versioning.commit([path.join(root, 'A')], 'Saved')
      await move(path.join(root, 'A'), path.join(root, 'folder', 'A'), versioning)
      expect(await git(root, 'log', '-1', '--format=%s')).toBe('Moved A to folder/A')
      const files = await git(root, 'show', '--name-only', '--format=')
      expect(files).toContain('A/package.yaml')
      expect(files).toContain('folder/A/package.yaml')
      expect(await git(root, 'status', '--porcelain', '--', 'A', 'folder')).toBe('')
    })
  })

  test('a plain directory move commits nothing', async () => {
    await withTempRepo(async (root) => {
      const versioning = new LocalVersioning()
      await writeFiles(root, { 'D/file.txt': 'x\n' })
      await versioning.init(root)
      await move(path.join(root, 'D'), path.join(root, 'E'), versioning)
      await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
    })
  })
})
