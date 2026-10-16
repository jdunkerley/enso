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
