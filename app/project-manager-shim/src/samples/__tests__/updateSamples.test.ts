/**
 * @file Update Sample and Update All with real git: a sample in a versioned repository is updated in
 * place as a new version; one that is not is kept as an edited copy (`installSamples.test.ts` has
 * the rest of that route).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { versioningFor, withTempRepo } from '../../localVersioning/__tests__/testRepo.js'
import type { LocalVersioning } from '../../localVersioning/index.js'
import { hashSample, LocalSamples, type SamplesManifest } from '../index.js'

// Every test runs dozens of real git processes, which take seconds on Windows (see
// `localVersioning.test.ts`, #395).
vi.setConfig({ testTimeout: 30_000 })

const NOW = new Date(2026, 10, 6, 12)
const BEFORE = 'Saved before updating the sample'

let root: string
let bundled: string
let projects: string
let samples: string
let versioning: LocalVersioning

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}
const git = (...args: string[]) =>
  runCommand('git', args, { cwd: projects }).then(({ stdout }) => stdout.trim())
/** The subjects of the commits touching `pathspec`, newest first. */
const subjects = async (pathspec = '.') =>
  (await git('log', '--format=%s', '--', pathspec)).split('\n').filter((line) => line !== '')
function manifest(): SamplesManifest {
  return JSON.parse(read(path.join(samples, '.samples.json')))
}

/** A projects folder in a versioned repository, with the samples installed and committed. */
async function withVersionedSamples(body: () => Promise<void>) {
  await withTempRepo(
    async (dir) => {
      root = path.dirname(dir)
      projects = dir
      samples = path.join(projects, 'Samples')
      bundled = path.join(root, 'bundle')
      write(path.join(bundled, 'One', 'package.yaml'), 'name: One\n')
      write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 1\n')
      write(path.join(bundled, 'Two', 'package.yaml'), 'name: Two\n')
      write(path.join(bundled, 'Two', 'src', 'Main.enso'), 'main = 2\n')
      write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n')
      versioning = versioningFor(projects)
      await versioning.init(projects)
      await git('config', 'user.name', 'Tester')
      await git('config', 'user.email', 'tester@example.com')
      await new LocalSamples(bundled, projects).sync()
      await git('add', '-A')
      await git('commit', '-q', '-m', 'Installed')
      await body()
    },
    { init: true },
  )
}

/** Edit `One`, and ship a new bundle of it, so that it has an update. */
function editOneAndChangeBundle() {
  write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 1 + 41\n')
  write(path.join(samples, 'One', 'src', 'Mine.enso'), 'mine = 1\n')
  write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 100\n')
  write(path.join(bundled, 'One', 'src', 'New.enso'), 'new = 1\n')
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a sample in a versioned repository', () => {
  test('is reported as updated by a new version', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      const status = await new LocalSamples(bundled, projects).status(versioning)
      expect(status.samples.find((sample) => sample.name === 'One')).toMatchObject({
        state: 'updateAvailable',
        route: 'version',
        copyName: null,
      })
    })
  })

  test('is saved as a version, updated in place and saved again, with no copy', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      write(path.join(samples, 'One', 'package.yaml'), 'name: One\nlabels:\n  - Mine\n')
      write(path.join(samples, 'One', '.enso', 'project.json'), '{"id":"kept"}')
      write(path.join(samples, 'One', 'notes.bak'), 'ignored by git\n')
      const local = new LocalSamples(bundled, projects)
      expect(await local.update('One', { versioning, now: NOW })).toEqual({
        updated: ['One'],
        versioned: ['One'],
        kept: [],
        unrenamed: [],
        fellBack: [],
        failed: [],
      })
      const one = path.join(samples, 'One')
      expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 100\n')
      expect(read(path.join(one, 'src', 'New.enso'))).toBe('new = 1\n')
      // The user's added file is gone from the folder, and in the version before the update.
      expect(fs.existsSync(path.join(one, 'src', 'Mine.enso'))).toBe(false)
      expect(await git('show', 'HEAD~1:Samples/One/src/Mine.enso')).toBe('mine = 1')
      expect(await git('show', 'HEAD~1:Samples/One/src/Main.enso')).toBe('main = 1 + 41')
      // What git ignores, the IDE's .enso/ and the labels stay.
      expect(read(path.join(one, 'notes.bak'))).toBe('ignored by git\n')
      expect(read(path.join(one, '.enso', 'project.json'))).toBe('{"id":"kept"}')
      expect(read(path.join(one, 'package.yaml'))).toContain('Mine')
      expect(await subjects('Samples/One')).toEqual(['Updated sample One', BEFORE, 'Installed'])
      expect(fs.readdirSync(samples).filter((name) => name.includes('_edited_'))).toEqual([])
      expect(await git('status', '--porcelain', '--', 'Samples/One')).toBe('')
      // The manifest records the new bundle: the update is gone.
      expect(manifest().samples['One']).toBe(await hashSample(path.join(bundled, 'One')))
      const status = await local.status(versioning)
      expect(status.samples.find((sample) => sample.name === 'One')?.state).not.toBe(
        'updateAvailable',
      )
    })
  })

  test('with no uncommitted change, is updated with one version only', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      await git('add', '-A')
      await git('commit', '-q', '-m', 'My edit')
      await new LocalSamples(bundled, projects).update('One', { versioning, now: NOW })
      expect(await subjects('Samples/One')).toEqual(['Updated sample One', 'My edit', 'Installed'])
    })
  })

  test('falls back to an edited copy when the version before cannot be saved', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      // Another git holds the index.
      write(path.join(projects, '.git', 'index.lock'), '')
      const result = await new LocalSamples(bundled, projects).update('One', {
        versioning,
        now: NOW,
      })
      expect(result).toMatchObject({
        updated: ['One'],
        versioned: [],
        kept: ['One_edited_2026_11_06'],
        fellBack: [{ name: 'One', error: expect.stringContaining('index.lock') }],
      })
      expect(read(path.join(samples, 'One_edited_2026_11_06', 'src', 'Mine.enso'))).toBe(
        'mine = 1\n',
      )
      expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 100\n')
    })
  })

  test('that fails part way is put back as the version saved before, which is kept', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      const cp = fs.promises.cp
      vi.spyOn(fs.promises, 'cp').mockImplementation(async (source, destination, options) => {
        if (String(source) === path.join(bundled, 'One')) throw new Error('disk full')
        return cp(source, destination, options)
      })
      await expect(
        new LocalSamples(bundled, projects).update('One', { versioning, now: NOW }),
      ).rejects.toThrow(/saved as the version 'Saved before updating the sample'.*disk full/)
      const one = path.join(samples, 'One')
      expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 1 + 41\n')
      expect(read(path.join(one, 'src', 'Mine.enso'))).toBe('mine = 1\n')
      expect(await subjects('Samples/One')).toEqual([BEFORE, 'Installed'])
      expect(await git('status', '--porcelain', '--', 'Samples/One')).toBe('')
      expect(manifest().samples['One']).not.toBe(await hashSample(path.join(bundled, 'One')))
    })
  })

  test('that is open is not changed, and nothing is saved', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      await expect(
        new LocalSamples(bundled, projects).update('One', {
          versioning,
          isOpen: async () => true,
          now: NOW,
        }),
      ).rejects.toThrow(/is open/)
      expect(await subjects('Samples/One')).toEqual(['Installed'])
    })
  })

  test('in a repository whose versioning is off, is kept as an edited copy', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      await versioning.disable(projects)
      const local = new LocalSamples(bundled, projects)
      expect(
        (await local.status(versioning)).samples.find((sample) => sample.name === 'One'),
      ).toMatchObject({ route: 'copy', copyName: 'One_edited_2026_11_06' })
      expect(await local.update('One', { versioning, now: NOW })).toMatchObject({
        versioned: [],
        kept: ['One_edited_2026_11_06'],
        fellBack: [],
      })
      expect(await subjects('Samples/One')).toEqual(['Installed'])
    })
  })
})

describe('updateAll', () => {
  test('updates only the samples with an update, each by its route', async () => {
    await withVersionedSamples(async () => {
      editOneAndChangeBundle()
      // Two is edited, with no update: Update All leaves it alone.
      write(path.join(samples, 'Two', 'src', 'Main.enso'), 'main = 22\n')
      const local = new LocalSamples(bundled, projects)
      expect(await local.updateAll({ versioning, now: NOW })).toEqual({
        updated: ['One'],
        versioned: ['One'],
        kept: [],
        unrenamed: [],
        fellBack: [],
        failed: [],
      })
      expect(read(path.join(samples, 'Two', 'src', 'Main.enso'))).toBe('main = 22\n')
      expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 100\n')
    })
  })
})
