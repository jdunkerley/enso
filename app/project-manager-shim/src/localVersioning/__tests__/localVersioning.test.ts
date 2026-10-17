import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { findGit, runGit } from '../git.js'
import {
  ENSO_IGNORE_LINES,
  LocalVersioning,
  VERSIONING_TIMEOUT_MESSAGE,
  VERSIONING_TIMEOUT_MS,
} from '../index.js'
import { versioningFor, withTempRepo, writeFiles } from './testRepo.js'

vi.mock('../git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git.js')>()
  return { ...actual, findGit: vi.fn(actual.findGit), runGit: vi.fn(actual.runGit) }
})

const git = (cwd: string, ...args: string[]) =>
  runCommand('git', args, { cwd }).then(({ stdout }) => stdout.trim())

/** Resolves once a timer is pending (with fake timers), so the timeout has started. */
async function waitForTimer() {
  const deadline = Date.now() + 3_000
  while (vi.getTimerCount() === 0 && Date.now() < deadline)
    await new Promise((resolve) => setImmediate(resolve))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
}

const project = (name: string) => ({
  [`${name}/package.yaml`]: `name: ${name}\n`,
  [`${name}/src/Main.enso`]: 'main = 1\n',
  [`${name}/.enso/project.json`]: '{}\n',
})

async function withProjects(body: (root: string, versioning: LocalVersioning) => Promise<void>) {
  await withTempRepo(async (root) => {
    await writeFiles(root, { ...project('A'), ...project('B') })
    await body(root, versioningFor(root))
  })
}

/** A repository with `A` and `B`, with an identity configured. */
async function withRepo(body: (root: string, versioning: LocalVersioning) => Promise<void>) {
  await withProjects(async (root, versioning) => {
    await versioning.init(root)
    await git(root, 'config', 'user.name', 'Tester')
    await git(root, 'config', 'user.email', 'tester@example.com')
    await body(root, versioning)
  })
}

describe('status', () => {
  test('without git', async () => {
    await withProjects(async (root, versioning) => {
      vi.mocked(findGit).mockResolvedValueOnce(null)
      expect(await versioning.status(path.join(root, 'A'))).toEqual({
        git: false,
        repoRoot: null,
        changed: false,
        lastVersion: null,
        blocked: null,
        optedOut: false,
        enabled: false,
      })
    })
  })

  test('outside a repository', async () => {
    await withProjects(async (root, versioning) => {
      expect(await versioning.status(path.join(root, 'A'))).toEqual({
        git: true,
        repoRoot: null,
        changed: false,
        lastVersion: null,
        blocked: null,
        optedOut: false,
        enabled: false,
      })
    })
  })

  test('a fresh repository has changes and no version', async () => {
    await withProjects(async (root, versioning) => {
      await versioning.init(root)
      const status = await versioning.status(path.join(root, 'A'))
      expect(status.git).toBe(true)
      expect(status.repoRoot).not.toBeNull()
      expect(status.changed).toBe(true)
      expect(status.lastVersion).toBeNull()
      expect(status.blocked).toBeNull()
    })
  })
})

describe('init', () => {
  test('writes the root .gitignore', async () => {
    await withProjects(async (root, versioning) => {
      const { repoRoot } = await versioning.init(root)
      expect(await fs.realpath(repoRoot)).toBe(await fs.realpath(root))
      expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('**/.enso/\n*.bak\n')
      expect(ENSO_IGNORE_LINES).toEqual(['**/.enso/', '*.bak'])
    })
  })

  test('appends to an existing .gitignore', async () => {
    await withProjects(async (root, versioning) => {
      await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n')
      await versioning.init(root)
      expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(
        'node_modules/\n**/.enso/\n*.bak\n',
      )
    })
  })

  test('leaves a .gitignore that already ignores .enso', async () => {
    await withProjects(async (root, versioning) => {
      await fs.writeFile(path.join(root, '.gitignore'), '**/.enso/\n')
      await versioning.init(root)
      expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('**/.enso/\n')
    })
  })
})

describe('commit', () => {
  test('commits only the given project', async () => {
    await withRepo(async (root, versioning) => {
      const { id } = await versioning.commit([path.join(root, 'A')], 'Saved')
      expect(id).toMatch(/^[0-9a-f]{40}$/)
      const a = await versioning.status(path.join(root, 'A'))
      expect(a.changed).toBe(false)
      expect(a.lastVersion?.id).toBe(id)
      expect(Number.isNaN(Date.parse(a.lastVersion?.date ?? ''))).toBe(false)
      const b = await versioning.status(path.join(root, 'B'))
      expect(b.changed).toBe(true)
      expect(b.lastVersion).toBeNull()
      const stat = await git(root, 'show', '--stat', '--format=%s', id!)
      expect(stat).toContain('Saved')
      expect(stat).toContain('A/package.yaml')
      expect(stat).not.toContain('B/')
    })
  })

  test('returns null when nothing changed', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([path.join(root, 'A')], 'Saved')
      expect(await versioning.commit([path.join(root, 'A')], 'Again')).toEqual({ id: null })
    })
  })

  test('ignores changes under .enso', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([path.join(root, 'A')], 'Saved')
      await fs.writeFile(path.join(root, 'A', '.enso', 'project.json'), '{"x":1}\n')
      expect((await versioning.status(path.join(root, 'A'))).changed).toBe(false)
      expect(await versioning.commit([path.join(root, 'A')], 'Again')).toEqual({ id: null })
    })
  })

  test('sees changes to source files', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([path.join(root, 'A')], 'Saved')
      await fs.writeFile(path.join(root, 'A', 'src', 'Main.enso'), 'main = 2\n')
      expect((await versioning.status(path.join(root, 'A'))).changed).toBe(true)
    })
  })

  test('commits two paths at once', async () => {
    await withRepo(async (root, versioning) => {
      const { id } = await versioning.commit([path.join(root, 'A'), path.join(root, 'B')], 'Both')
      expect(id).not.toBeNull()
      expect((await versioning.status(path.join(root, 'B'))).changed).toBe(false)
    })
  })

  test('uses the fallback identity when none is configured', async () => {
    await withProjects(async (root, versioning) => {
      await versioning.init(root)
      await git(root, 'config', 'user.useConfigOnly', 'true')
      const { id } = await versioning.commit([path.join(root, 'A')], 'Saved')
      expect(await git(root, 'log', '-1', '--format=%an <%ae>', id!)).toBe(
        'Enso <noreply@enso.org>',
      )
    })
  })

  test('works through a symlinked project path', async () => {
    await withRepo(async (root, versioning) => {
      const link = path.join(path.dirname(root), 'link')
      try {
        await fs.symlink(root, link, 'junction')
      } catch (error) {
        console.warn('Skipping symlink assertions: cannot create a link:', error)
        return
      }
      const linked = path.join(link, 'A')
      expect((await versioning.status(linked)).changed).toBe(true)
      const { id } = await versioning.commit([linked], 'Saved')
      expect(id).not.toBeNull()
      const status = await versioning.status(linked)
      expect(status.changed).toBe(false)
      expect(status.lastVersion?.id).toBe(id)
    })
  })
})

describe('.enso exclusion without a .gitignore rule', () => {
  test('.enso changes are neither changed nor committed', async () => {
    await withProjects(async (root, versioning) => {
      await git(root, 'init')
      await git(root, 'config', 'user.name', 'Tester')
      await git(root, 'config', 'user.email', 'tester@example.com')
      const a = path.join(root, 'A')
      await versioning.enable(root)
      await git(root, 'add', '-f', 'A/.enso/project.json')
      await git(root, 'commit', '-m', 'Tracked .enso')
      await versioning.commit([a], 'Saved')
      await fs.writeFile(path.join(a, '.enso', 'project.json'), '{"x":1}\n')
      await fs.writeFile(path.join(a, '.enso', 'new.json'), '{}\n')
      expect((await versioning.status(a)).changed).toBe(false)
      await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'main = 2\n')
      const { id } = await versioning.commit([a], 'Edit')
      const files = await git(root, 'show', '--name-only', '--format=', id!)
      expect(files).toContain('A/src/Main.enso')
      expect(files).not.toContain('/.enso/')
    })
  })
})

describe('a locked repository', () => {
  test('commit rejects with a message about the lock', async () => {
    await withRepo(async (root, versioning) => {
      await fs.writeFile(path.join(root, '.git', 'index.lock'), '')
      await expect(versioning.commit([path.join(root, 'A')], 'Saved')).rejects.toThrow(/lock/i)
    })
  })
})

describe('a repository in the middle of a merge', () => {
  test('is blocked', async () => {
    await withRepo(async (root, versioning) => {
      const main = path.join(root, 'A', 'src', 'Main.enso')
      await versioning.commit([root], 'Base')
      const base = await git(root, 'branch', '--show-current')
      await git(root, 'checkout', '-b', 'other')
      await fs.writeFile(main, 'main = 2\n')
      await git(root, 'commit', '-am', 'Other')
      await git(root, 'checkout', base)
      await fs.writeFile(main, 'main = 3\n')
      await git(root, 'commit', '-am', 'Main')
      await expect(git(root, 'merge', 'other')).rejects.toBeDefined()

      const status = await versioning.status(path.join(root, 'A'))
      expect(status.blocked).toBeTruthy()
      await expect(versioning.commit([path.join(root, 'A')], 'Nope')).rejects.toThrow(/merge/i)
    })
  })
})

describe('log, fileAt and setComment', () => {
  /** Commits `A` three times, with a `B` commit between each. Returns `A`'s version ids, oldest first. */
  async function history(root: string, versioning: LocalVersioning) {
    const a = path.join(root, 'A')
    const b = path.join(root, 'B')
    const ids: string[] = []
    for (const [n, message] of ['one', 'two', 'three'].entries()) {
      await fs.writeFile(path.join(a, 'src', 'Main.enso'), `main = ${n + 10}\n`)
      ids.push((await versioning.commit([a], message)).id!)
      await fs.writeFile(path.join(b, 'src', 'Main.enso'), `main = ${n + 20}\n`)
      await versioning.commit([b], `b${n}`)
    }
    return ids
  }

  test('log lists the project newest first', async () => {
    await withRepo(async (root, versioning) => {
      const ids = await history(root, versioning)
      const entries = await versioning.log(path.join(root, 'A'))
      expect(entries.map((e) => e.id)).toEqual([...ids].reverse())
      expect(entries.map((e) => e.comment)).toEqual(['three', 'two', 'one'])
      expect(entries.map((e) => e.isLatest)).toEqual([true, false, false])
      expect(entries[0]!.author).toEqual({ name: 'Tester', email: 'tester@example.com' })
      expect(entries[0]!.date).toMatch(/^\d{4}-\d\d-\d\dT/)
    })
  })

  test('setComment overrides only that version', async () => {
    await withRepo(async (root, versioning) => {
      const ids = await history(root, versioning)
      const a = path.join(root, 'A')
      await versioning.setComment(a, ids[1]!, 'Edited')
      expect((await versioning.log(a)).map((e) => e.comment)).toEqual(['three', 'Edited', 'one'])
      await versioning.setComment(a, ids[1]!, 'Edited again')
      expect((await versioning.log(a))[1]!.comment).toBe('Edited again')
    })
  })

  test('setComment works without a configured identity', async () => {
    await withRepo(async (root, versioning) => {
      const ids = await history(root, versioning)
      await git(root, 'config', '--unset', 'user.name')
      await git(root, 'config', '--unset', 'user.email')
      const a = path.join(root, 'A')
      await versioning.setComment(a, ids[0]!, 'Anonymous')
      expect((await versioning.log(a))[2]!.comment).toBe('Anonymous')
    })
  })

  test('log is empty without versions', async () => {
    await withRepo(async (root, versioning) => {
      expect(await versioning.log(path.join(root, 'A'))).toEqual([])
      await versioning.commit([path.join(root, 'B')], 'Only B')
      expect(await versioning.log(path.join(root, 'A'))).toEqual([])
    })
  })

  test('fileAt reads a file at a version', async () => {
    await withRepo(async (root, versioning) => {
      const ids = await history(root, versioning)
      const a = path.join(root, 'A')
      expect(await versioning.fileAt(a, ids[0]!, 'src/Main.enso')).toBe('main = 10\n')
      expect(await versioning.fileAt(a, ids[0]!, 'src\\Main.enso')).toBe('main = 10\n')
      await expect(versioning.fileAt(a, ids[0]!, 'src/Missing.enso')).rejects.toThrow(
        /does not exist/,
      )
    })
  })

  test('works for a project at the repository root', async () => {
    await withTempRepo(
      async (root) => {
        await writeFiles(root, { 'package.yaml': 'name: R\n', 'src/Main.enso': 'main = 1\n' })
        await git(root, 'config', 'user.name', 'Tester')
        await git(root, 'config', 'user.email', 'tester@example.com')
        const versioning = versioningFor(root)
        await versioning.enable(root)
        const { id } = await versioning.commit([root], 'Root')
        expect((await versioning.log(root)).map((e) => e.id)).toEqual([id])
        expect(await versioning.fileAt(root, id!, 'src/Main.enso')).toBe('main = 1\n')
      },
      { init: true },
    )
  })
})

describe('untrusted arguments', () => {
  test.each(['--output=x', 'HEAD~1', '-h', ''])('version id %j is rejected', async (bad) => {
    await withRepo(async (root, versioning) => {
      const ids = await (async () => {
        const a = path.join(root, 'A')
        await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'main = 5\n')
        return [(await versioning.commit([a], 'one')).id!]
      })()
      expect(ids).toHaveLength(1)
      const a = path.join(root, 'A')
      const target = bad.startsWith('--output=') ? bad : 'x'
      await expect(versioning.fileAt(a, bad, 'src/Main.enso')).rejects.toThrow(/version id/i)
      await expect(versioning.setComment(a, bad, 'c')).rejects.toThrow(/version id/i)
      // git runs in the repository root, so that is where `--output=x` would write.
      const written = target.replace('--output=', '')
      await expect(fs.access(path.join(root, written))).rejects.toBeDefined()
      await expect(fs.access(path.join(a, written))).rejects.toBeDefined()
    })
  })

  test('fileAt cannot leave the project', async () => {
    await withRepo(async (root, versioning) => {
      const { id } = await versioning.commit([root], 'All')
      const a = path.join(root, 'A')
      await expect(versioning.fileAt(a, id!, '../B/src/Main.enso')).rejects.toThrow(/project/i)
      await expect(versioning.fileAt(a, id!, 'src\\..\\..\\B/src/Main.enso')).rejects.toThrow(
        /project/i,
      )
      await expect(versioning.fileAt(a, id!, '/B/src/Main.enso')).rejects.toThrow(/project/i)
    })
  })

  test("setComment rejects another project's version and writes no note", async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const b = path.join(root, 'B')
      await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'main = 7\n')
      await versioning.commit([a], 'a')
      await fs.writeFile(path.join(b, 'src', 'Main.enso'), 'main = 8\n')
      const { id } = await versioning.commit([b], 'b')
      await expect(versioning.setComment(a, id!, 'Hijacked')).rejects.toThrow(/not a version/i)
      expect(await git(root, 'notes', '--ref=enso', 'list')).toBe('')
    })
  })
})

describe('restore and exportAt', () => {
  /** `A` at v1 (`Main` = v1, `data/x.csv`), v2 (`v2`, no x, `data/y.csv`), then an uncommitted `v3`. */
  async function twoVersionsAndEdit(root: string, versioning: LocalVersioning) {
    const a = path.join(root, 'A')
    await writeFiles(root, { 'A/src/Main.enso': 'v1', 'A/data/x.csv': 'x' })
    const v1 = (await versioning.commit([a], 'one')).id!
    await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'v2')
    await fs.rm(path.join(a, 'data', 'x.csv'))
    await fs.writeFile(path.join(a, 'data', 'y.csv'), 'y')
    await versioning.commit([a], 'two')
    await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'v3')
    return { a, v1 }
  }

  test('restore saves the current state, then restores the version', async () => {
    await withRepo(async (root, versioning) => {
      const { a, v1 } = await twoVersionsAndEdit(root, versioning)
      const b = path.join(root, 'B')
      await versioning.commit([b], 'b')
      await fs.writeFile(path.join(b, 'src', 'Main.enso'), 'b-edit')
      const ensoBefore = await fs.readFile(path.join(a, '.enso', 'project.json'))
      const date = (await versioning.log(a)).find((e) => e.id === v1)!.date

      const { id } = await versioning.restore(a, v1)

      const entries = await versioning.log(a)
      expect(id).toBe(entries[0]!.id)
      expect(entries.map((e) => e.comment)).toEqual([
        `Restored version from ${date}`,
        'Saved before restore',
        'two',
        'one',
      ])
      expect(await versioning.fileAt(a, entries[1]!.id, 'src/Main.enso')).toBe('v3')
      expect(await fs.readFile(path.join(a, 'src', 'Main.enso'), 'utf8')).toBe('v1')
      await expect(fs.access(path.join(a, 'data', 'x.csv'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(a, 'data', 'y.csv'))).rejects.toBeDefined()
      expect(await fs.readFile(path.join(a, '.enso', 'project.json'))).toEqual(ensoBefore)
      expect((await versioning.status(a)).changed).toBe(false)
      expect(await fs.readFile(path.join(b, 'src', 'Main.enso'), 'utf8')).toBe('b-edit')
    })
  })

  test('restore without changes makes no "Saved before restore" version', async () => {
    await withRepo(async (root, versioning) => {
      const { a, v1 } = await twoVersionsAndEdit(root, versioning)
      await versioning.commit([a], 'three')
      await versioning.restore(a, v1)
      expect((await versioning.log(a)).map((e) => e.comment.split(' from ')[0])).toEqual([
        'Restored version',
        'three',
        'two',
        'one',
      ])
    })
  })

  test('restore and exportAt reject bad ids and other projects versions', async () => {
    await withRepo(async (root, versioning) => {
      const { a } = await twoVersionsAndEdit(root, versioning)
      const b = path.join(root, 'B')
      await fs.writeFile(path.join(b, 'src', 'Main.enso'), 'b2')
      const other = (await versioning.commit([b], 'b')).id!
      const target = path.join(root, 'out')
      await expect(versioning.restore(a, 'HEAD')).rejects.toThrow(/version id/i)
      await expect(versioning.exportAt(a, '--output=x', target)).rejects.toThrow(/version id/i)
      await expect(versioning.restore(a, other)).rejects.toThrow(/not a version/i)
      await expect(versioning.exportAt(a, other, target)).rejects.toThrow(/not a version/i)
      await expect(fs.access(target)).rejects.toBeDefined()
      expect(await fs.readFile(path.join(a, 'src', 'Main.enso'), 'utf8')).toBe('v3')
    })
  })

  test('exportAt writes the version into a new directory and leaves the repository alone', async () => {
    await withRepo(async (root, versioning) => {
      const { a, v1 } = await twoVersionsAndEdit(root, versioning)
      await git(root, 'add', '-A')
      const indexBefore = await git(root, 'ls-files', '-s')
      const copy = path.join(root, 'A-copy')
      await versioning.exportAt(a, v1, copy)
      expect(await fs.readFile(path.join(copy, 'src', 'Main.enso'), 'utf8')).toBe('v1')
      await expect(fs.access(path.join(copy, 'data', 'x.csv'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(copy, 'package.yaml'))).resolves.toBeUndefined()
      await expect(fs.access(path.join(copy, '.enso'))).rejects.toBeDefined()
      expect(await git(root, 'ls-files', '-s')).toBe(indexBefore)
      expect(await fs.readFile(path.join(a, 'src', 'Main.enso'), 'utf8')).toBe('v3')
    })
  })

  test('exportAt rejects an existing target', async () => {
    await withRepo(async (root, versioning) => {
      const { a, v1 } = await twoVersionsAndEdit(root, versioning)
      const copy = path.join(root, 'taken')
      await fs.mkdir(copy)
      await fs.writeFile(path.join(copy, 'mine.txt'), 'keep')
      await expect(versioning.exportAt(a, v1, copy)).rejects.toThrow(/exists/i)
      expect(await fs.readFile(path.join(copy, 'mine.txt'), 'utf8')).toBe('keep')
    })
  })

  test('exportAt creates missing parent directories', async () => {
    await withRepo(async (root, versioning) => {
      const { a, v1 } = await twoVersionsAndEdit(root, versioning)
      const copy = path.join(root, 'new', 'parent', 'copy')
      await versioning.exportAt(a, v1, copy)
      expect(await fs.readFile(path.join(copy, 'src', 'Main.enso'), 'utf8')).toBe('v1')
    })
  })

  test('both work for a project at the repository root', async () => {
    await withTempRepo(
      async (root) => {
        await writeFiles(root, { 'package.yaml': 'name: R\n', 'src/Main.enso': 'v1' })
        await git(root, 'config', 'user.name', 'Tester')
        await git(root, 'config', 'user.email', 'tester@example.com')
        const versioning = versioningFor(root)
        await versioning.init(root)
        const v1 = (await versioning.commit([root], 'one')).id!
        await fs.writeFile(path.join(root, 'src', 'Main.enso'), 'v2')
        const copy = path.join(path.dirname(root), 'copy')
        await versioning.exportAt(root, v1, copy)
        expect(await fs.readFile(path.join(copy, 'src', 'Main.enso'), 'utf8')).toBe('v1')
        await versioning.restore(root, v1)
        expect(await fs.readFile(path.join(root, 'src', 'Main.enso'), 'utf8')).toBe('v1')
        expect((await versioning.status(root)).changed).toBe(false)
      },
      { init: true },
    )
  })
})

describe('commit across a move', () => {
  test('renaming a never-versioned project commits the new path', async () => {
    await withRepo(async (root, versioning) => {
      await fs.rename(path.join(root, 'A'), path.join(root, 'C'))
      const { id } = await versioning.commit([path.join(root, 'A'), path.join(root, 'C')], 'Moved')
      expect(id).toMatch(/^[0-9a-f]{40}$/)
      const files = await git(root, 'show', '--name-only', '--format=', id!)
      expect(files).toContain('C/package.yaml')
      expect(files).not.toContain('B/')
    })
  })

  test('moving a versioned project commits the removal and the addition together', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([path.join(root, 'A')], 'Saved')
      await fs.rename(path.join(root, 'A'), path.join(root, 'C'))
      const { id } = await versioning.commit([path.join(root, 'A'), path.join(root, 'C')], 'Moved')
      expect(id).not.toBeNull()
      const files = await git(root, 'show', '--name-status', '--format=', '-M', id!)
      expect(files).toMatch(/A\/package\.yaml/)
      expect(files).toMatch(/C\/package\.yaml/)
      expect(await git(root, 'rev-list', '--count', 'HEAD')).toBe('2')
    })
  })

  test('a move with nothing versioned on either side commits nothing', async () => {
    await withRepo(async (root, versioning) => {
      await fs.mkdir(path.join(root, 'D'))
      await fs.rename(path.join(root, 'D'), path.join(root, 'E'))
      expect(
        await versioning.commit([path.join(root, 'D'), path.join(root, 'E')], 'Moved'),
      ).toEqual({ id: null })
    })
  })
})

describe('commits are automatic snapshots', () => {
  test('a failing pre-commit hook does not block a commit', async () => {
    await withRepo(async (root, versioning) => {
      const hook = path.join(root, '.git', 'hooks', 'pre-commit')
      await fs.mkdir(path.dirname(hook), { recursive: true })
      await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      expect((await versioning.commit([path.join(root, 'A')], 'Saved')).id).not.toBeNull()
    })
  })

  test('signing with an unusable gpg program does not block a commit or a comment', async () => {
    await withRepo(async (root, versioning) => {
      await git(root, 'config', 'commit.gpgsign', 'true')
      await git(root, 'config', 'gpg.program', path.join(root, 'no-such-gpg'))
      const { id } = await versioning.commit([path.join(root, 'A')], 'Saved')
      expect(id).not.toBeNull()
      await versioning.setComment(path.join(root, 'A'), id!, 'Note')
      expect((await versioning.log(path.join(root, 'A')))[0]?.comment).toBe('Note')
    })
  })
})

describe('concurrent operations on one repository', () => {
  test('two commits of the same project both settle, and only one version is made', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const results = await Promise.all([
        versioning.commit([a], 'first'),
        versioning.commit([a], 'second'),
      ])
      const ids = results.map((r) => r.id)
      expect(ids.filter((id) => id != null)).toHaveLength(1)
      expect(ids.filter((id) => id == null)).toHaveLength(1)
      const log = await versioning.log(a)
      expect(log.map((e) => e.id)).toEqual(ids.filter((id) => id != null))
    })
  })

  test('commits of two projects get their own ids and only their own files', async () => {
    await withRepo(async (root, versioning) => {
      const [a, b] = await Promise.all([
        versioning.commit([path.join(root, 'A')], 'a'),
        versioning.commit([path.join(root, 'B')], 'b'),
      ])
      expect(a.id).toMatch(/^[0-9a-f]{40}$/)
      expect(b.id).toMatch(/^[0-9a-f]{40}$/)
      expect(a.id).not.toBe(b.id)
      const aFiles = await git(root, 'show', '--name-only', '--format=%s', a.id!)
      const bFiles = await git(root, 'show', '--name-only', '--format=%s', b.id!)
      expect(aFiles).toMatch(/^a\n/)
      expect(aFiles).toContain('A/package.yaml')
      expect(aFiles).not.toContain('B/')
      expect(bFiles).toMatch(/^b\n/)
      expect(bFiles).toContain('B/package.yaml')
      expect(bFiles).not.toContain('A/')
    })
  })

  test('a failed operation does not hold the repository', async () => {
    await withRepo(async (root, versioning) => {
      const lock = path.join(root, '.git', 'index.lock')
      await fs.writeFile(lock, '')
      await expect(versioning.commit([path.join(root, 'A')], 'Saved')).rejects.toThrow(/lock/i)
      await fs.rm(lock)
      expect((await versioning.commit([path.join(root, 'A')], 'Saved')).id).not.toBeNull()
    })
  })
})

describe("the user's own staging", () => {
  test('a change staged in another project is neither committed nor unstaged', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([root], 'Base')
      await fs.writeFile(path.join(root, 'A', 'src', 'Main.enso'), 'main = 2\n')
      await fs.writeFile(path.join(root, 'B', 'x.txt'), 'staged\n')
      await git(root, 'add', 'B/x.txt')
      const { id } = await versioning.commit([path.join(root, 'A')], 'A only')
      expect(await git(root, 'show', '--name-only', '--format=', id!)).toBe('A/src/Main.enso')
      expect(await git(root, 'diff', '--cached', '--name-only')).toBe('B/x.txt')
    })
  })
})

describe('paths with spaces and non-ASCII characters', () => {
  test('status, commit, log, fileAt and restore', async () => {
    await withTempRepo(async (tmp) => {
      const root = path.join(tmp, 'r é')
      const project = path.join(root, 'Mój projekt ü')
      await writeFiles(project, { 'package.yaml': 'name: P\n', 'src/Main.enso': 'v1' })
      const versioning = versioningFor(root)
      await versioning.init(root)
      await git(root, 'config', 'user.name', 'Tester')
      await git(root, 'config', 'user.email', 'tester@example.com')
      expect((await versioning.status(project)).changed).toBe(true)
      const v1 = (await versioning.commit([project], 'one')).id!
      expect(v1).toMatch(/^[0-9a-f]{40}$/)
      const status = await versioning.status(project)
      expect(status.changed).toBe(false)
      expect(status.lastVersion?.id).toBe(v1)
      await fs.writeFile(path.join(project, 'src', 'Main.enso'), 'v2')
      expect((await versioning.status(project)).changed).toBe(true)
      expect((await versioning.log(project)).map((e) => e.id)).toEqual([v1])
      expect(await versioning.fileAt(project, v1, 'src/Main.enso')).toBe('v1')
      await versioning.restore(project, v1)
      expect(await fs.readFile(path.join(project, 'src', 'Main.enso'), 'utf8')).toBe('v1')
      expect((await versioning.log(project)).map((e) => e.comment.split(' from ')[0])).toEqual([
        'Restored version',
        'Saved before restore',
        'one',
      ])
    })
  })
})

describe('git state the IDE does not own', () => {
  test.each([
    ['CHERRY_PICK_HEAD', /cherry-pick/i],
    ['REVERT_HEAD', /revert/i],
    ['BISECT_LOG', /bisect/i],
  ])('a repository with %s is blocked', async (file, message) => {
    await withRepo(async (root, versioning) => {
      const { id } = await versioning.commit([root], 'Base')
      await fs.writeFile(path.join(root, '.git', file), `${id}\n`)
      await fs.writeFile(path.join(root, 'A', 'src', 'Main.enso'), 'main = 2\n')
      expect((await versioning.status(path.join(root, 'A'))).blocked).toMatch(message)
      await expect(versioning.commit([path.join(root, 'A')], 'Nope')).rejects.toThrow(message)
    })
  })

  test('status does not rewrite the index (no optional locks)', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      await versioning.commit([a], 'Saved')
      const index = path.join(root, '.git', 'index')
      // A new mtime with the same content makes git refresh, and normally write, the index.
      const future = new Date(Date.now() + 60_000)
      await fs.utimes(path.join(a, 'package.yaml'), future, future)
      const before = (await fs.stat(index)).mtimeMs
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect((await versioning.status(a)).changed).toBe(false)
      expect((await fs.stat(index)).mtimeMs).toBe(before)
    })
  })

  test('an inherited GIT_DIR does not redirect versioning to another repository', async () => {
    await withRepo(async (root, versioning) => {
      const other = path.join(path.dirname(root), 'other')
      await fs.mkdir(other)
      await git(other, 'init', '-b', 'main')
      const saved = process.env.GIT_DIR
      process.env.GIT_DIR = path.join(other, '.git')
      let id: string | null
      try {
        id = (await versioning.commit([path.join(root, 'A')], 'Saved')).id
      } finally {
        if (saved === undefined) delete process.env.GIT_DIR
        else process.env.GIT_DIR = saved
      }
      expect(id).toMatch(/^[0-9a-f]{40}$/)
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(id)
      await expect(git(other, 'rev-parse', '--verify', 'HEAD')).rejects.toBeDefined()
    })
  })

  test("a post-commit hook does not run on the IDE's commits", async () => {
    await withRepo(async (root, versioning) => {
      const hook = path.join(root, '.git', 'hooks', 'post-commit')
      await fs.mkdir(path.dirname(hook), { recursive: true })
      await fs.writeFile(hook, '#!/bin/sh\necho ran > .git/hook-ran\n', { mode: 0o755 })
      const { id } = await versioning.commit([path.join(root, 'A')], 'Saved')
      await versioning.setComment(path.join(root, 'A'), id!, 'Note')
      await expect(fs.access(path.join(root, '.git', 'hook-ran'))).rejects.toBeDefined()
      // The hook does run for a commit made by hand, so the check above means something.
      await fs.writeFile(path.join(root, 'B', 'src', 'Main.enso'), 'main = 9\n')
      await git(root, 'add', 'B')
      await git(root, 'commit', '-m', 'By hand')
      await expect(fs.access(path.join(root, '.git', 'hook-ran'))).resolves.toBeUndefined()
    })
  })
})

describe('commitMove', () => {
  test('records where the project came from in an Enso-Moved-From trailer', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.commit([path.join(root, 'A')], 'Saved')
      await fs.mkdir(path.join(root, 'folder'))
      await fs.rename(path.join(root, 'A'), path.join(root, 'folder', 'A'))
      const warning = await versioning.commitMove(
        path.join(root, 'A'),
        path.join(root, 'folder', 'A'),
        ({ to }) => `Moved A to ${to}`,
      )
      expect(warning).toBeUndefined()
      expect(await git(root, 'log', '-1', '--format=%s')).toBe('Moved A to folder/A')
      expect(
        await git(root, 'log', '-1', '--format=%(trailers:key=Enso-Moved-From,valueonly)'),
      ).toBe('A')
      // The trailer is not part of the comment shown for the version.
      expect((await versioning.log(path.join(root, 'folder', 'A')))[0]?.comment).toBe(
        'Moved A to folder/A',
      )
    })
  })

  test('gives up after the timeout, including while finding the repository', async () => {
    await withRepo(async (root, versioning) => {
      const spy = vi.spyOn(versioning, 'repositoryOf').mockReturnValue(new Promise(() => {}))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const moving = versioning.commitMove(path.join(root, 'A'), path.join(root, 'C'), 'Moved')
        await waitForTimer()
        await vi.advanceTimersByTimeAsync(VERSIONING_TIMEOUT_MS + 1)
        expect(await moving).toBe(VERSIONING_TIMEOUT_MESSAGE)
      } finally {
        vi.useRealTimers()
        spy.mockRestore()
      }
    })
  })
})

describe('consent', () => {
  /** A repository made with plain `git init`, which nothing has agreed to version. */
  async function withUnenabledRepo(
    body: (root: string, versioning: LocalVersioning, a: string) => Promise<void>,
  ) {
    await withTempRepo(
      async (root) => {
        await writeFiles(root, { ...project('A'), ...project('B') })
        await git(root, 'config', 'user.name', 'Tester')
        await git(root, 'config', 'user.email', 'tester@example.com')
        await body(root, versioningFor(root), path.join(root, 'A'))
      },
      { init: true },
    )
  }
  const notEnabled = () =>
    expect.objectContaining({
      message: expect.stringContaining('Versioning is not enabled for the repository at'),
    })

  test('status.enabled is false, then true after enable, then false after disable', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      expect(await versioning.status(a)).toMatchObject({ git: true, enabled: false, changed: true })
      await versioning.enable(root)
      expect((await versioning.status(a)).enabled).toBe(true)
      await versioning.disable(root)
      expect((await versioning.status(a)).enabled).toBe(false)
    })
  })

  test('init enables the repository it creates', async () => {
    await withProjects(async (root, versioning) => {
      await versioning.init(root)
      expect((await versioning.status(path.join(root, 'A'))).enabled).toBe(true)
    })
  })

  test('enable rejects a path that is not a repository root', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      await expect(versioning.enable(a)).rejects.toThrow(/not the root of a git repository/)
      await expect(versioning.enable(path.join(root, 'missing'))).rejects.toThrow(
        /not the root of a git repository/,
      )
      expect((await versioning.status(a)).enabled).toBe(false)
    })
    await withProjects(async (root, versioning) => {
      await expect(versioning.enable(root)).rejects.toThrow(/not the root of a git repository/)
    })
  })

  test('a manual commit rejects with the exact message', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      const repoRoot = (await versioning.status(a)).repoRoot!
      await expect(versioning.commit([a], 'x')).rejects.toThrow(
        new Error(`Versioning is not enabled for the repository at ${repoRoot}.`),
      )
      await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
    })
  })

  test('commitIfEnabled records nothing until the repository is enabled', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      expect(await versioning.commitIfEnabled([a], 'Saved on close')).toEqual({ id: null })
      await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
      await versioning.enable(root)
      expect((await versioning.commitIfEnabled([a], 'Saved on close')).id).toMatch(/^[0-9a-f]{40}$/)
    })
  })

  test('commitMove skips a repository that is not enabled, silently', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const moved = path.join(root, 'C')
        await fs.rename(a, moved)
        expect(await versioning.commitMove(a, moved, 'Moved')).toBeUndefined()
        expect(error).not.toHaveBeenCalled()
        await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
      } finally {
        error.mockRestore()
      }
    })
  })

  test('restore and setComment reject, and read-only operations work', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      await versioning.enable(root)
      const id = (await versioning.commit([a], 'one')).id!
      await fs.writeFile(path.join(a, 'src', 'Main.enso'), 'main = 2\n')
      await versioning.disable(root)
      const head = await git(root, 'rev-parse', 'HEAD')
      await expect(versioning.restore(a, id)).rejects.toThrow(notEnabled())
      await expect(versioning.setComment(a, id, 'c')).rejects.toThrow(notEnabled())
      expect(await git(root, 'rev-parse', 'HEAD')).toBe(head)
      expect(await fs.readFile(path.join(a, 'src', 'Main.enso'), 'utf8')).toBe('main = 2\n')
      expect((await versioning.log(a)).map((e) => e.id)).toEqual([id])
      expect(await versioning.fileAt(a, id, 'src/Main.enso')).toBe('main = 1\n')
      const copy = path.join(path.dirname(root), 'copy')
      await versioning.exportAt(a, id, copy)
      expect(await fs.readFile(path.join(copy, 'src', 'Main.enso'), 'utf8')).toBe('main = 1\n')
    })
  })

  test('consent is per repository', async () => {
    await withUnenabledRepo(async (root, versioning, a) => {
      await versioning.enable(root)
      const nested = path.join(a, 'nested')
      await fs.mkdir(nested)
      await git(nested, 'init')
      expect((await versioning.status(nested)).enabled).toBe(false)
      expect((await versioning.status(a)).enabled).toBe(true)
    })
  })
})

describe('enableIfInside', () => {
  test('enables a repository at the projects root', async () => {
    await withProjects(async (root, versioning) => {
      await git(root, 'init', '-b', 'main')
      expect(await versioning.enableIfInside(root, root)).toEqual({ enabled: true })
      expect((await versioning.status(path.join(root, 'A'))).enabled).toBe(true)
    })
  })

  test('enables a repository inside the projects root', async () => {
    await withTempRepo(async (dir) => {
      const team = path.join(dir, 'projects', 'team')
      await writeFiles(team, project('A'))
      await git(team, 'init', '-b', 'main')
      const versioning = versioningFor(dir)
      expect(await versioning.enableIfInside(team, path.join(dir, 'projects'))).toEqual({
        enabled: true,
      })
      expect((await versioning.status(path.join(team, 'A'))).enabled).toBe(true)
    })
  })

  test('leaves a repository above the projects root alone', async () => {
    await withProjects(async (root, versioning) => {
      await git(root, 'init', '-b', 'main')
      await fs.mkdir(path.join(root, 'projects'))
      expect(await versioning.enableIfInside(root, path.join(root, 'projects'))).toEqual({
        enabled: false,
      })
      expect((await versioning.status(path.join(root, 'A'))).enabled).toBe(false)
    })
  })

  test('a sibling whose name starts with the root’s is not inside it', async () => {
    await withTempRepo(async (dir) => {
      const sibling = path.join(dir, 'projects-old')
      await writeFiles(sibling, project('A'))
      await git(sibling, 'init', '-b', 'main')
      await fs.mkdir(path.join(dir, 'projects'))
      expect(await versioningFor(dir).enableIfInside(sibling, path.join(dir, 'projects'))).toEqual({
        enabled: false,
      })
    })
  })

  test('compares real paths: a root reached through a junction (OneDrive)', async () => {
    await withProjects(async (root, versioning) => {
      await git(root, 'init', '-b', 'main')
      const link = path.join(path.dirname(root), 'linked-root')
      // 'junction' needs no privileges on Windows; elsewhere the type is ignored.
      await fs.symlink(root, link, 'junction')
      expect(await versioning.enableIfInside(root, link)).toEqual({ enabled: true })
    })
  })

  test('never re-enables a repository the user turned off; an explicit enable does', async () => {
    await withRepo(async (root, versioning) => {
      await versioning.disable(root)
      expect(await versioning.enableIfInside(root, root)).toEqual({ enabled: false })
      const status = await versioning.status(path.join(root, 'A'))
      expect(status).toMatchObject({ enabled: false, optedOut: true })
      await versioning.enable(root)
      expect(await versioning.status(path.join(root, 'A'))).toMatchObject({
        enabled: true,
        optedOut: false,
      })
    })
  })

  test('an already enabled repository stays enabled wherever the root is', async () => {
    await withRepo(async (root, versioning) => {
      expect(await versioning.enableIfInside(root, path.join(root, 'elsewhere'))).toEqual({
        enabled: true,
      })
    })
  })
})

describe('history across moves', () => {
  /** A, saved twice, moved to `folder/A`, and saved once more. */
  async function movedProject(root: string, versioning: LocalVersioning) {
    const a = path.join(root, 'A')
    const first = (await versioning.commit([a], 'first')).id!
    await writeFiles(root, {
      'A/src/Main.enso': 'main = 2\n',
      'A/src/Extra.enso': 'x = 1\n',
    })
    const second = (await versioning.commit([a], 'second')).id!
    await fs.mkdir(path.join(root, 'folder'))
    await fs.rename(a, path.join(root, 'folder', 'A'))
    await versioning.commitMove(a, path.join(root, 'folder', 'A'), ({ to }) => `Moved A to ${to}`)
    const moved = await git(root, 'rev-parse', 'HEAD')
    await writeFiles(root, { 'folder/A/src/Main.enso': 'main = 3\n' })
    const third = (await versioning.commit([path.join(root, 'folder', 'A')], 'third')).id!
    return { first, second, moved, third, project: path.join(root, 'folder', 'A') }
  }

  test('log lists the versions from before the move, newest first', async () => {
    await withRepo(async (root, versioning) => {
      const { first, second, moved, third, project } = await movedProject(root, versioning)
      const log = await versioning.log(project)
      expect(log.map((v) => v.id)).toEqual([third, moved, second, first])
      expect(log.map((v) => v.comment)).toEqual(['third', 'Moved A to folder/A', 'second', 'first'])
      expect(log.map((v) => v.isLatest)).toEqual([true, false, false, false])
      expect(log[0]).not.toHaveProperty('relativePath')
    })
  })

  test('follows a chain of moves', async () => {
    await withRepo(async (root, versioning) => {
      const first = (await versioning.commit([path.join(root, 'A')], 'first')).id!
      await fs.rename(path.join(root, 'A'), path.join(root, 'B2'))
      await versioning.commitMove(path.join(root, 'A'), path.join(root, 'B2'), 'Renamed to B2')
      await fs.rename(path.join(root, 'B2'), path.join(root, 'C'))
      await versioning.commitMove(path.join(root, 'B2'), path.join(root, 'C'), 'Renamed to C')
      const log = await versioning.log(path.join(root, 'C'))
      expect(log.map((v) => v.comment)).toEqual(['Renamed to C', 'Renamed to B2', 'first'])
      expect(log.at(-1)?.id).toBe(first)
    })
  })

  // `A*`, `A?` and `[A]` are not unsafe: the pathspec is literal, so they match no `A`.
  test.each(['../B', '/A', 'A\\B', ':(top)A', '-A', './A', 'A//B', 'A*', 'A?', '[A]'])(
    'a trailer naming %s does not lead to A',
    async (from) => {
      await withRepo(async (root, versioning) => {
        await versioning.commit([path.join(root, 'A')], 'first')
        // The hand-made commit is the first at `N`, so its trailer is read.
        await writeFiles(root, { 'N/package.yaml': 'name: N\n', 'N/src/Main.enso': 'n\n' })
        await git(root, 'add', '-A', '--', 'N')
        await git(root, 'commit', '-q', '-m', 'Hand-made', '-m', `Enso-Moved-From: ${from}`)
        const log = await versioning.log(path.join(root, 'N'))
        expect(log.map((v) => v.comment)).toEqual(['Hand-made'])
      })
    },
  )

  test('follows A to B and back to A, through every segment', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const b = path.join(root, 'B2')
      const first = (await versioning.commit([a], 'first')).id!
      await fs.rename(a, b)
      await versioning.commitMove(a, b, 'A to B2')
      const away = await git(root, 'rev-parse', 'HEAD')
      await writeFiles(root, { 'B2/src/Main.enso': 'main = 2\n' })
      const edited = (await versioning.commit([b], 'edited at B2')).id!
      await fs.rename(b, a)
      await versioning.commitMove(b, a, 'B2 to A')
      const back = await git(root, 'rev-parse', 'HEAD')
      const log = await versioning.log(a)
      expect(log.map((v) => v.comment)).toEqual(['B2 to A', 'edited at B2', 'A to B2', 'first'])
      expect(log.map((v) => v.id)).toEqual([back, edited, away, first])
      const contents = ['main = 2\n', 'main = 2\n', 'main = 1\n', 'main = 1\n']
      for (const [i, { id }] of log.entries())
        expect(await versioning.fileAt(a, id, 'src/Main.enso')).toBe(contents[i])
      for (const [i, { id }] of [...log.entries()].reverse()) {
        await versioning.restore(a, id)
        expect(await fs.readFile(path.join(a, 'src', 'Main.enso'), 'utf8')).toBe(contents[i])
        expect(await git(root, 'status', '--porcelain', '--', 'A', 'B2')).toBe('')
      }
    })
  }, 30_000)

  test('a reused name shows the moved project, not the deleted one', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const b = path.join(root, 'B')
      const aFirst = (await versioning.commit([a], 'A first')).id!
      await versioning.commit([b], 'B first')
      await fs.rm(b, { recursive: true })
      await versioning.commit([b], 'B deleted')
      await fs.rename(a, b)
      await versioning.commitMove(a, b, 'A to B')
      const log = await versioning.log(b)
      expect(log.map((v) => v.comment)).toEqual(['A to B', 'A first'])
      expect(log.at(-1)?.id).toBe(aFirst)
    })
  })

  test('a move away from a path is never listed for the project that later lives there', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      await versioning.commit([a], 'old A')
      await fs.rename(a, path.join(root, 'Elsewhere'))
      await versioning.commitMove(a, path.join(root, 'Elsewhere'), 'A to Elsewhere')
      await writeFiles(root, project('A'))
      await versioning.commit([a], 'new A')
      expect((await versioning.log(a)).map((v) => v.comment)).toEqual(['new A'])
    })
  })

  test('a cross-move restore that cannot be done changes nothing', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const moved = path.join(root, 'folder', 'A')
      // This repository tracks the project's `.enso/`, at both paths.
      await git(root, 'add', '-A', '--', 'A')
      await git(root, 'add', '-f', '--', 'A/.enso')
      await git(root, 'commit', '-q', '-m', 'tracked')
      const tracked = await git(root, 'rev-parse', 'HEAD')
      await fs.mkdir(path.join(root, 'folder'))
      await fs.rename(a, moved)
      await versioning.commitMove(a, moved, 'Moved')
      await git(root, 'add', '-f', '--', 'folder/A/.enso')
      await git(root, 'rm', '-q', '-r', '--cached', '--', 'A/.enso')
      await git(root, 'commit', '-q', '-m', 'tracked again')
      await writeFiles(root, { 'folder/A/src/Main.enso': 'main = 3\n' })
      await expect(versioning.restore(moved, tracked)).rejects.toThrow(/\.enso/)
      expect(await git(root, 'diff', '--cached', '--name-status')).toBe('')
      expect(await fs.readFile(path.join(moved, 'src', 'Main.enso'), 'utf8')).toBe('main = 3\n')
      expect(await git(root, 'ls-files', '--', 'folder/A/src/Main.enso')).toBe(
        'folder/A/src/Main.enso',
      )
    })
  })

  test('a project at the repository root lists only versions from since it was there', async () => {
    await withTempRepo(
      async (root) => {
        await git(root, 'config', 'user.name', 'Tester')
        await git(root, 'config', 'user.email', 'tester@example.com')
        const versioning = versioningFor(root)
        await versioning.init(root)
        await writeFiles(root, project('Old'))
        const before = (await versioning.commit([path.join(root, 'Old')], 'Old only')).id!
        await fs.rm(path.join(root, 'Old'), { recursive: true })
        await writeFiles(root, { 'package.yaml': 'name: R\n', 'src/Main.enso': 'main = 1\n' })
        const rooted = (await versioning.commit([root], 'Root')).id!
        expect((await versioning.log(root)).map((v) => v.id)).toEqual([rooted])
        await expect(versioning.restore(root, before)).rejects.toThrow(/not a version/)
        await expect(fs.access(path.join(root, 'Old'))).rejects.toThrow()
        expect(await fs.readFile(path.join(root, 'src', 'Main.enso'), 'utf8')).toBe('main = 1\n')
      },
      { init: true },
    )
  })

  test('fileAt reads a version from before the move at its old path', async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning)
      expect(await versioning.fileAt(project, first, 'src/Main.enso')).toBe('main = 1\n')
    })
  })

  test('exportAt exports a version from before the move', async () => {
    await withRepo(async (root, versioning) => {
      const { second, project } = await movedProject(root, versioning)
      const target = path.join(path.dirname(root), 'exported')
      await versioning.exportAt(project, second, target)
      expect(await fs.readFile(path.join(target, 'src', 'Main.enso'), 'utf8')).toBe('main = 2\n')
      expect(await fs.readFile(path.join(target, 'src', 'Extra.enso'), 'utf8')).toBe('x = 1\n')
    })
  })

  test('restore brings a version from before the move back to the current path', async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning)
      const { id } = await versioning.restore(project, first)
      expect(await fs.readFile(path.join(project, 'src', 'Main.enso'), 'utf8')).toBe('main = 1\n')
      await expect(fs.access(path.join(project, 'src', 'Extra.enso'))).rejects.toThrow()
      await expect(fs.access(path.join(root, 'A'))).rejects.toThrow()
      expect(await git(root, 'log', '-1', '--format=%H')).toBe(id)
      expect(await git(root, 'log', '-1', '--format=%s')).toMatch(/^Restored version from /)
      expect(await git(root, 'status', '--porcelain', '--', 'folder/A')).toBe('')
      await fs.access(path.join(project, '.enso', 'project.json'))
    })
  })

  test('a version from before the move can be commented', async () => {
    await withRepo(async (root, versioning) => {
      const { first, project } = await movedProject(root, versioning)
      await versioning.setComment(project, first, 'The original')
      expect((await versioning.log(project)).at(-1)?.comment).toBe('The original')
    })
  })
})

describe('paths with glob characters are literal', () => {
  test('status, commit and a cross-move restore never touch a sibling the path would match as a glob', async () => {
    await withRepo(async (root, versioning) => {
      const project = path.join(root, 'P [x]')
      // An untracked file, which `P [x]` matches as a glob.
      const sibling = path.join(root, 'P x')
      const old = path.join(root, 'A')
      const first = (await versioning.commit([old], 'first')).id!
      await fs.rename(old, project)
      await versioning.commitMove(old, project, 'Moved')
      await writeFiles(root, { 'P [x]/src/Extra.enso': 'x = 1\n' })
      await versioning.commit([project], 'extra')
      await fs.writeFile(sibling, 'mine\n')
      expect((await versioning.status(project)).changed).toBe(false)
      await writeFiles(root, { 'P [x]/src/Main.enso': 'main = 5\n' })
      await versioning.commit([project], 'edited')
      expect(await git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
        'P [x]/src/Main.enso',
      )
      await versioning.restore(project, first)
      expect(await fs.readFile(path.join(project, 'src', 'Main.enso'), 'utf8')).toBe('main = 1\n')
      await expect(fs.access(path.join(project, 'src', 'Extra.enso'))).rejects.toThrow()
      expect(await fs.readFile(sibling, 'utf8')).toBe('mine\n')
      expect(await git(root, 'status', '--porcelain', '--', 'P x')).toBe('?? "P x"')
    })
  })

  test('renaming inside a folder whose name has glob characters keeps the earlier history', async () => {
    await withRepo(async (root, versioning) => {
      await writeFiles(root, project('P [x]/A'))
      const a = path.join(root, 'P [x]', 'A')
      const b = path.join(root, 'P [x]', 'B')
      const first = (await versioning.commit([a], 'first')).id!
      await fs.rename(a, b)
      await versioning.commitMove(a, b, 'Renamed')
      const log = await versioning.log(b)
      expect(log.map((v) => v.comment)).toEqual(['Renamed', 'first'])
      expect(log.at(-1)?.id).toBe(first)
    })
  })
})

describe('a restore that fails after saving', () => {
  test('says the work was saved as "Saved before restore"', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const v1 = (await versioning.commit([a], 'one')).id!
      await writeFiles(root, { 'A/src/Main.enso': 'unsaved\n' })
      const real = vi.mocked(runGit).getMockImplementation()!
      vi.mocked(runGit).mockImplementation((cwd, args, options) =>
        args[0] === 'restore' ? Promise.reject(new Error('boom')) : real(cwd, args, options),
      )
      try {
        await expect(versioning.restore(a, v1)).rejects.toThrow(
          "Restoring failed; your work was saved as the version 'Saved before restore' and can be restored from the list. (boom)",
        )
      } finally {
        vi.mocked(runGit).mockImplementation(real)
      }
      const [latest] = await versioning.log(a)
      expect(latest?.comment).toBe('Saved before restore')
      expect(await versioning.fileAt(a, latest!.id, 'src/Main.enso')).toBe('unsaved\n')
    })
  })
})

describe('setComment with an empty comment', () => {
  test('removes the note, so the commit message shows again', async () => {
    await withRepo(async (root, versioning) => {
      const a = path.join(root, 'A')
      const { id } = await versioning.commit([a], 'Saved')
      await versioning.setComment(a, id!, 'Mine')
      await versioning.setComment(a, id!, '  ')
      expect((await versioning.log(a))[0]?.comment).toBe('Saved')
      await versioning.setComment(a, id!, '')
    })
  })

  test('works without a git identity (the notes commit uses the fallback)', async () => {
    await withProjects(async (root, versioning) => {
      await versioning.init(root)
      const a = path.join(root, 'A')
      const { id } = await versioning.commit([a], 'Saved')
      await versioning.setComment(a, id!, 'Mine')
      await versioning.setComment(a, id!, '')
      expect((await versioning.log(a))[0]?.comment).toBe('Saved')
    })
  })
})
