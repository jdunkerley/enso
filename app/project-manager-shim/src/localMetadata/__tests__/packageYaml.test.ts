import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { readPackageLabels, writePackageLabels } from '../packageYaml.js'
import { withTempDirectory } from './testUtils.js'

const PACKAGE = '# A comment\nname: Example\nnamespace: local\nversion: 0.0.1\n'

async function project(dir: string, content = PACKAGE) {
  await fs.writeFile(path.join(dir, 'package.yaml'), content)
  return dir
}

describe('package.yaml labels', () => {
  test('a package without labels has none', () =>
    withTempDirectory(async (dir) => {
      expect(await readPackageLabels(await project(dir))).toEqual([])
    }))

  test('writing labels keeps the other keys, their order and comments', () =>
    withTempDirectory(async (dir) => {
      await writePackageLabels(await project(dir), ['b', 'a'])
      const text = await fs.readFile(path.join(dir, 'package.yaml'), 'utf8')
      expect(text).toBe(`${PACKAGE}labels:\n  - b\n  - a\n`)
      expect(await readPackageLabels(dir)).toEqual(['b', 'a'])
    }))

  test('an empty list removes the key', () =>
    withTempDirectory(async (dir) => {
      await writePackageLabels(await project(dir), ['a'])
      await writePackageLabels(dir, [])
      expect(await fs.readFile(path.join(dir, 'package.yaml'), 'utf8')).toBe(PACKAGE)
    }))

  test('non-string labels are ignored on read', () =>
    withTempDirectory(async (dir) => {
      await project(dir, `${PACKAGE}labels:\n  - a\n  - 3\n`)
      expect(await readPackageLabels(dir)).toEqual(['a'])
    }))

  test('writing to a missing package.yaml throws', () =>
    withTempDirectory(async (dir) => {
      await expect(writePackageLabels(dir, ['a'])).rejects.toThrow()
    }))
})
