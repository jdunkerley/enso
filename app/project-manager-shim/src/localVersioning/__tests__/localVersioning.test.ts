import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { findGit } from '../git.js'
import { ENSO_IGNORE_LINES, LocalVersioning } from '../index.js'
import { withTempRepo, writeFiles } from './testRepo.js'

vi.mock('../git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git.js')>()
  return { ...actual, findGit: vi.fn(actual.findGit) }
})

const git = (cwd: string, ...args: string[]) =>
  runCommand('git', args, { cwd }).then(({ stdout }) => stdout.trim())

const project = (name: string) => ({
  [`${name}/package.yaml`]: `name: ${name}\n`,
  [`${name}/src/Main.enso`]: 'main = 1\n',
  [`${name}/.enso/project.json`]: '{}\n',
})

async function withProjects(body: (root: string, versioning: LocalVersioning) => Promise<void>) {
  await withTempRepo(async (root) => {
    await writeFiles(root, { ...project('A'), ...project('B') })
    await body(root, new LocalVersioning())
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
        const versioning = new LocalVersioning()
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
      await expect(fs.access(path.join(a, target.replace('--output=', '')))).rejects.toBeDefined()
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
