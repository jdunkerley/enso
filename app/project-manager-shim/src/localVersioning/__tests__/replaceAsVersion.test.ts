/**
 * @file `LocalVersioning.replaceAsVersion`'s guards, with real git: what is saved before, what a
 * failure puts back, and what is never touched.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { VersionSaveError, type LocalVersioning } from '../index.js'
import { versioningFor, withTempRepo, writeFiles } from './testRepo.js'

// Real git, dozens of processes per test (see `localVersioning.test.ts`, #395).
vi.setConfig({ testTimeout: 30_000 })

const git = (cwd: string, ...args: string[]) =>
  runCommand('git', args, { cwd }).then(({ stdout }) => stdout.trim())
const MESSAGES = { before: 'Before', after: 'After' } as const

/** A repository with the project `P` saved, an identity, and versioning enabled. */
async function withProject(
  body: (root: string, project: string, versioning: LocalVersioning) => Promise<void>,
) {
  await withTempRepo(
    async (root) => {
      const versioning = versioningFor(root)
      await versioning.init(root)
      await git(root, 'config', 'user.name', 'Tester')
      await git(root, 'config', 'user.email', 'tester@example.com')
      await writeFiles(root, { 'P/package.yaml': 'name: P\n', 'P/src/Main.enso': 'main = 1\n' })
      await git(root, 'add', '-A')
      await git(root, 'commit', '-q', '-m', 'Initial')
      await body(root, path.join(root, 'P'), versioning)
    },
    { init: true },
  )
}

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  )

describe('replaceAsVersion', () => {
  test('a failure after the change cleans what it added, and keeps ignored files and .enso/', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, {
        'P/src/Main.enso': 'main = 2\n',
        'P/notes.bak': 'ignored\n',
        'P/.enso/state.json': '{}\n',
      })
      await expect(
        versioning.replaceAsVersion(
          project,
          async (files) => {
            for (const file of files) await fs.rm(file)
            await writeFiles(root, { 'P/src/New.enso': 'new = 1\n', 'P/src/Main.enso': 'x\n' })
            throw new Error('disk full')
          },
          MESSAGES,
        ),
      ).rejects.toThrow(/saved as the version 'Before'.*disk full/)
      expect(await exists(path.join(project, 'src', 'New.enso'))).toBe(false)
      expect(await fs.readFile(path.join(project, 'src', 'Main.enso'), 'utf8')).toBe('main = 2\n')
      expect(await fs.readFile(path.join(project, 'package.yaml'), 'utf8')).toBe('name: P\n')
      expect(await fs.readFile(path.join(project, 'notes.bak'), 'utf8')).toBe('ignored\n')
      expect(await fs.readFile(path.join(project, '.enso', 'state.json'), 'utf8')).toBe('{}\n')
      expect(await git(root, 'status', '--porcelain', '--', 'P')).toBe('')
    })
  })

  test('both versions hold the project only; a change staged elsewhere stays staged', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, {
        'P/src/Main.enso': 'main = 2\n',
        'Other/staged.txt': 'staged\n',
        'Other/untracked.txt': 'untracked\n',
        'top.txt': 'top\n',
      })
      await git(root, 'add', '--', 'Other/staged.txt')
      await versioning.replaceAsVersion(
        project,
        async () => {
          await writeFiles(root, { 'P/src/Main.enso': 'main = 3\n' })
        },
        MESSAGES,
      )
      const changedIn = async (revision: string) =>
        (await git(root, 'show', '--name-only', '--format=', revision)).split('\n')
      expect(await changedIn('HEAD')).toEqual(['P/src/Main.enso'])
      expect(await changedIn('HEAD~1')).toEqual(['P/src/Main.enso'])
      expect(await git(root, 'log', '-2', '--format=%s')).toBe('After\nBefore')
      expect((await git(root, 'status', '--porcelain')).split('\n').sort()).toEqual(
        ['A  Other/staged.txt', '?? Other/untracked.txt', '?? top.txt'].sort(),
      )
    })
  })

  test('a project with no saved version, every file of it ignored, is not changed', async () => {
    await withProject(async (root, _project, versioning) => {
      await writeFiles(root, { 'Q/a.bak': 'ignored\n' })
      const replace = vi.fn(async () => {})
      await expect(
        versioning.replaceAsVersion(path.join(root, 'Q'), replace, MESSAGES),
      ).rejects.toThrow(VersionSaveError)
      expect(replace).not.toHaveBeenCalled()
    })
  })

  test('a change the version before cannot hold leaves the project unchanged', async () => {
    await withProject(async (root, project, versioning) => {
      // A repository inside the project, with changes of its own: the outer one records it as a
      // commit id, and its uncommitted changes cannot be saved.
      const nested = path.join(project, 'nested')
      await fs.mkdir(nested)
      await git(nested, 'init', '-q', '-b', 'main')
      await git(nested, 'config', 'user.name', 'Tester')
      await git(nested, 'config', 'user.email', 'tester@example.com')
      await writeFiles(nested, { 'a.txt': 'a\n' })
      await git(nested, 'add', '-A')
      await git(nested, 'commit', '-q', '-m', 'Nested')
      await writeFiles(nested, { 'a.txt': 'changed\n' })
      const replace = vi.fn(async () => {})
      await expect(versioning.replaceAsVersion(project, replace, MESSAGES)).rejects.toThrow(
        VersionSaveError,
      )
      expect(replace).not.toHaveBeenCalled()
      expect(await fs.readFile(path.join(nested, 'a.txt'), 'utf8')).toBe('changed\n')
    })
  })

  test('beforeSave runs first, and what it throws is thrown with no version saved', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n' })
      const busy = new Error('busy')
      await expect(
        versioning.replaceAsVersion(project, async () => {}, MESSAGES, {
          beforeSave: () => Promise.reject(busy),
        }),
      ).rejects.toBe(busy)
      expect(await git(root, 'log', '--format=%s')).toBe('Initial')
    })
  })

  test('alsoCommit adds a tracked file to the version after, never an untracked one', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'tracked.json': '1\n', 'untracked.json': '1\n' })
      await git(root, 'add', '--', 'tracked.json')
      await git(root, 'commit', '-q', '-m', 'Track')
      await versioning.replaceAsVersion(
        project,
        async () => {
          await writeFiles(root, {
            'P/src/Main.enso': 'main = 3\n',
            'tracked.json': '2\n',
            'untracked.json': '2\n',
          })
        },
        MESSAGES,
        { alsoCommit: [path.join(root, 'tracked.json'), path.join(root, 'untracked.json')] },
      )
      expect((await git(root, 'show', '--name-only', '--format=', 'HEAD')).split('\n')).toEqual([
        'P/src/Main.enso',
        'tracked.json',
      ])
      expect(await git(root, 'ls-files', '--', 'untracked.json')).toBe('')
    })
  })
})

describe('replaceAsVersion before it saves anything', () => {
  test('an ignored file it would overwrite refuses it, and retries add no version', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n', 'P/data.bak': 'mine\n' })
      const replace = vi.fn(async () => {})
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          versioning.replaceAsVersion(project, replace, MESSAGES, {
            protect: [path.join(project, 'data.bak'), path.join(project, 'src', 'Main.enso')],
          }),
        ).rejects.toThrow(/git ignores changed files the update would replace: data\.bak$/)
      }
      expect(replace).not.toHaveBeenCalled()
      expect(await git(root, 'log', '--format=%s')).toBe('Initial')
    })
  })

  test('a failure cleans only what it may have written, not a file the user saved meanwhile', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n' })
      const written = path.join(project, 'src', 'New.enso')
      await expect(
        versioning.replaceAsVersion(
          project,
          async () => {
            await writeFiles(root, { 'P/src/New.enso': 'new\n', 'P/late.txt': 'the user\n' })
            throw new Error('disk full')
          },
          MESSAGES,
          { writes: [written] },
        ),
      ).rejects.toThrow(/disk full/)
      expect(await exists(written)).toBe(false)
      expect(await fs.readFile(path.join(project, 'late.txt'), 'utf8')).toBe('the user\n')
    })
  })

  test("the files it gives are under the project path as given, not git's spelling of it", async () => {
    await withProject(async (root, _project, versioning) => {
      const link = path.join(path.dirname(root), 'link')
      await fs.symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n' })
      const given: string[] = []
      await versioning.replaceAsVersion(
        path.join(link, 'P'),
        async (files) => {
          given.push(...files)
        },
        MESSAGES,
      )
      expect(given.sort()).toEqual(
        [path.join(link, 'P', 'package.yaml'), path.join(link, 'P', 'src', 'Main.enso')].sort(),
      )
    })
  })

  test('an alsoCommit path outside the repository is left out', async () => {
    await withProject(async (root, project, versioning) => {
      await git(project, 'init', '-q', '-b', 'main')
      await git(project, 'config', 'user.name', 'Tester')
      await git(project, 'config', 'user.email', 'tester@example.com')
      await versioning.enable(project)
      await git(project, 'add', '-A')
      await git(project, 'commit', '-q', '-m', 'Own')
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n', 'outside.json': '1\n' })
      await versioning.replaceAsVersion(project, async () => {}, MESSAGES, {
        alsoCommit: [path.join(root, 'outside.json')],
      })
      expect(await git(project, 'log', '--format=%s')).toBe('Before\nOwn')
    })
  })
})

describe('ignoredPaths', () => {
  test('names the paths git ignores, not tracked ones', async () => {
    await withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'P/a.bak': 'x\n', 'P/b.txt': 'x\n', 'P/t.bak': 'x\n' })
      await git(root, 'add', '-f', '--', 'P/t.bak')
      const paths = ['a.bak', 'b.txt', 't.bak'].map((file) => path.join(project, file))
      expect(await versioning.ignoredPaths(project, paths)).toEqual([paths[0]])
      expect(await versioning.ignoredPaths(project, [paths[1]!])).toEqual([])
    })
  })
})

describe('replaceAsVersion of a rename by case only', () => {
  /** Rename `P/Data/Sales.csv` to `P/data/sales.csv`, with new content, as an update does. */
  async function renameByCase(project: string) {
    await fs.rm(path.join(project, 'Data'), { recursive: true })
    await writeFiles(project, { 'data/sales.csv': 'new\n' })
  }
  const withSales = (
    body: (root: string, project: string, versioning: LocalVersioning) => Promise<void>,
  ) =>
    withProject(async (root, project, versioning) => {
      await writeFiles(root, { 'P/Data/Sales.csv': 'old\n' })
      await git(root, 'add', '-A')
      await git(root, 'commit', '-q', '-m', 'Sales')
      await writeFiles(root, { 'P/src/Main.enso': 'main = 2\n' })
      await body(root, project, versioning)
    })

  test('is saved as a version under the new names', async () => {
    await withSales(async (root, project, versioning) => {
      await versioning.replaceAsVersion(project, () => renameByCase(project), MESSAGES)
      const tracked = async (revision: string) =>
        (await git(root, 'ls-tree', '-r', '--name-only', revision, '--', 'P')).split('\n')
      expect(await tracked('HEAD')).toEqual([
        'P/data/sales.csv',
        'P/package.yaml',
        'P/src/Main.enso',
      ])
      expect(await tracked('HEAD~1')).toEqual([
        'P/Data/Sales.csv',
        'P/package.yaml',
        'P/src/Main.enso',
      ])
      expect(await git(root, 'show', 'HEAD:P/data/sales.csv')).toBe('new')
      expect(await git(root, 'status', '--porcelain', '--', 'P')).toBe('')
    })
  })

  test('that fails after it is staged is put back under the old names, nothing lost', async () => {
    await withSales(async (root, project, versioning) => {
      // The branch cannot be moved, so the commit fails once the index has the rename.
      const lock = path.join(root, '.git', 'refs', 'heads', 'main.lock')
      await expect(
        versioning.replaceAsVersion(
          project,
          async () => {
            await renameByCase(project)
            await fs.writeFile(lock, '')
          },
          MESSAGES,
        ),
      ).rejects.toThrow(/saved as the version 'Before'/)
      await fs.rm(lock)
      expect(await fs.readdir(project)).toContain('Data')
      expect(await fs.readdir(project)).not.toContain('data')
      expect(await fs.readdir(path.join(project, 'Data'))).toEqual(['Sales.csv'])
      expect(await fs.readFile(path.join(project, 'Data', 'Sales.csv'), 'utf8')).toBe('old\n')
      expect(await fs.readFile(path.join(project, 'src', 'Main.enso'), 'utf8')).toBe('main = 2\n')
      expect(await git(root, 'status', '--porcelain', '--', 'P')).toBe('')
    })
  })
})
