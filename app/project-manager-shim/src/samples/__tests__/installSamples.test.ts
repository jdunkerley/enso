import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  compareSample,
  hashSample,
  installSamples,
  LocalSamples,
  readSamplesManifest,
  type SamplesManifest,
} from '../index.js'

let root: string
let bundled: string
let projects: string
let samples: string

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}
function listing(directory: string) {
  return fs.readdirSync(directory).sort()
}
function manifest(): SamplesManifest {
  return JSON.parse(read(path.join(samples, '.samples.json')))
}

const NOW = new Date(2026, 10, 6, 12)

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-samples-'))
  bundled = path.join(root, 'resources', 'samples')
  projects = path.join(root, 'projects')
  samples = path.join(projects, 'Samples')
  write(path.join(bundled, 'One', 'package.yaml'), 'name: One\n')
  write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 1\n')
  write(path.join(bundled, 'One', 'output', 'README.txt'), 'outputs\n')
  write(path.join(bundled, 'Two', 'package.yaml'), 'name: Two\n')
  write(path.join(bundled, 'Two', 'src', 'Main.enso'), 'main = 2\n')
  write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n1,2\n')
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('compareSample', () => {
  test.each([
    // [bundle, disk, recorded, action, record, state]
    ['B', undefined, undefined, 'install', 'B', 'current'],
    ['B', undefined, 'A', 'keep', 'A', 'missing'],
    ['B', undefined, null, 'keep', null, 'missing'],
    ['B', 'B', undefined, 'keep', 'B', 'current'],
    ['B', 'B', 'A', 'keep', 'B', 'current'],
    ['B', 'B', null, 'keep', 'B', 'current'],
    ['B', 'A', 'A', 'update', 'B', 'current'],
    ['B', 'E', 'B', 'keep', 'B', 'edited'],
    ['B', 'E', 'A', 'keep', 'A', 'updateAvailable'],
    ['B', 'E', null, 'keep', null, 'updateAvailable'],
    ['B', 'E', undefined, 'keep', null, 'updateAvailable'],
  ] as const)(
    'bundle %s, disk %s, recorded %s: %s, records %s, %s',
    (bundle, disk, recorded, action, record, state) => {
      expect(compareSample(bundle, disk, recorded)).toEqual({ action, record, state })
    },
  )
})

describe('hashSample', () => {
  test("ignores hidden files, output/ and package.yaml's labels; not other changes", async () => {
    const one = path.join(bundled, 'One')
    const original = await hashSample(one)
    write(path.join(one, '.enso', 'project.json'), '{"id":"x"}')
    write(path.join(one, 'output', 'result.csv'), 'x\n')
    write(path.join(one, 'package.yaml'), 'name: One\nlabels:\n  - Mine\n')
    expect(await hashSample(one)).toBe(original)
    write(path.join(one, 'src', 'Other.enso'), 'x = 1\n')
    expect(await hashSample(one)).not.toBe(original)
  })

  test('is undefined for a missing directory', async () => {
    expect(await hashSample(path.join(root, 'nothing'))).toBeUndefined()
  })
})

describe('installSamples: the first start', () => {
  test('copies the bundle into <projects>/Samples, with a manifest', async () => {
    expect(await installSamples(bundled, projects)).toMatchObject({ installed: true })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
    expect(read(path.join(samples, 'Data', 'rows.csv'))).toBe('a,b\n1,2\n')
    expect(manifest()).toEqual({
      version: 1,
      samples: {
        One: await hashSample(path.join(bundled, 'One')),
        Two: await hashSample(path.join(bundled, 'Two')),
      },
      data: { 'rows.csv': expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
    // No staging directory is left behind.
    expect(listing(projects)).toEqual(['Samples'])
  })

  // In a dev run the bundled directory is the source `samples/`, whose contributor notes are kept
  // out of the packaged app by electron-builder's filter; the copy leaves them out too.
  test('leaves out the top-level CLAUDE.md, and only that one', async () => {
    write(path.join(bundled, 'CLAUDE.md'), '# samples')
    write(path.join(bundled, 'One', 'CLAUDE.md'), '# one')
    await installSamples(bundled, projects)
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
    expect(fs.existsSync(path.join(samples, 'One', 'CLAUDE.md'))).toBe(true)
  })

  test.each([undefined, 'missing'])('installs nothing when the bundle is %s', async (dir) => {
    const source = dir && path.join(root, dir)
    expect(await installSamples(source, projects)).toBeNull()
    expect(fs.existsSync(samples)).toBe(false)
  })
})

describe('installSamples: later starts', () => {
  beforeEach(async () => {
    await installSamples(bundled, projects)
  })

  test('change nothing when nothing changed', async () => {
    const before = read(path.join(samples, '.samples.json'))
    expect(await installSamples(bundled, projects)).toEqual({
      installed: false,
      copied: [],
      updated: [],
      updateAvailable: [],
    })
    expect(read(path.join(samples, '.samples.json'))).toBe(before)
  })

  test('copy in a sample and a Data file new in the bundle', async () => {
    write(path.join(bundled, 'Three', 'package.yaml'), 'name: Three\n')
    write(path.join(bundled, 'Data', 'more.csv'), 'c\n3\n')
    expect(await installSamples(bundled, projects)).toMatchObject({
      copied: ['Three', 'Data/more.csv'],
    })
    expect(read(path.join(samples, 'Three', 'package.yaml'))).toBe('name: Three\n')
    expect(read(path.join(samples, 'Data', 'more.csv'))).toBe('c\n3\n')
    expect(Object.keys(manifest().samples).sort()).toEqual(['One', 'Three', 'Two'])
    expect(Object.keys(manifest().data).sort()).toEqual(['more.csv', 'rows.csv'])
  })

  test('update an unedited sample whose bundle changed, keeping its id, outputs and labels', async () => {
    write(path.join(samples, 'One', '.enso', 'project.json'), '{"id":"one-id"}')
    write(path.join(samples, 'One', 'output', 'result.csv'), 'written\n')
    write(path.join(samples, 'One', 'package.yaml'), 'name: One\nlabels:\n  - Mine\n')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    write(path.join(bundled, 'One', 'package.yaml'), 'name: One\ndescription: New.\n')

    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
    const one = path.join(samples, 'One')
    expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 10\n')
    expect(read(path.join(one, '.enso', 'project.json'))).toBe('{"id":"one-id"}')
    expect(read(path.join(one, 'output', 'result.csv'))).toBe('written\n')
    expect(read(path.join(one, 'output', 'README.txt'))).toBe('outputs\n')
    expect(read(path.join(one, 'package.yaml'))).toBe(
      'name: One\ndescription: New.\nlabels:\n  - Mine\n',
    )
    expect(manifest().samples['One']).toBe(await hashSample(path.join(bundled, 'One')))
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })

  test('update an unedited Data file whose bundle changed', async () => {
    write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n3,4\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['Data/rows.csv'] })
    expect(read(path.join(samples, 'Data', 'rows.csv'))).toBe('a,b\n3,4\n')
  })

  test('leave an edited sample alone, and report its update', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    const recorded = manifest().samples['One']

    expect(await installSamples(bundled, projects)).toMatchObject({
      updated: [],
      updateAvailable: ['One'],
    })
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 99\n')
    expect(manifest().samples['One']).toBe(recorded)
    const status = await new LocalSamples(bundled, projects).status()
    expect(status.samples.find((sample) => sample.name === 'One')?.state).toBe('updateAvailable')
  })

  test('report an edited sample whose bundle did not change as edited, with no update', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updateAvailable: [] })
    const status = await new LocalSamples(bundled, projects).status()
    expect(status).toEqual({
      directory: samples.replace(/\\/g, '/'),
      samples: [
        { name: 'One', path: `${samples}/One`.replace(/\\/g, '/'), state: 'edited' },
        { name: 'Two', path: `${samples}/Two`.replace(/\\/g, '/'), state: 'current' },
      ],
    })
  })

  test('leave an edited Data file alone', async () => {
    write(path.join(samples, 'Data', 'rows.csv'), 'mine\n')
    write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n3,4\n')
    await installSamples(bundled, projects)
    expect(read(path.join(samples, 'Data', 'rows.csv'))).toBe('mine\n')
  })

  test('do not bring back a sample or Data file the user deleted', async () => {
    fs.rmSync(path.join(samples, 'Two'), { recursive: true })
    fs.rmSync(path.join(samples, 'Data', 'rows.csv'))
    write(path.join(bundled, 'Two', 'src', 'Main.enso'), 'main = 20\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ copied: [], updated: [] })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One'])
    expect(listing(path.join(samples, 'Data'))).toEqual([])
    const status = await new LocalSamples(bundled, projects).status()
    expect(status.samples.find((sample) => sample.name === 'Two')?.state).toBe('missing')
  })

  test('take an edited sample put back as bundled as current again', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 10\n')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updateAvailable: [] })
    expect(manifest().samples['One']).toBe(await hashSample(path.join(bundled, 'One')))
  })

  test('never change an open sample', async () => {
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    const isOpen = vi.fn(async (p: string) => p.endsWith('/One'))
    expect(await new LocalSamples(bundled, projects).sync(isOpen)).toMatchObject({
      updated: [],
      updateAvailable: ['One'],
    })
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
    // Updated once it is closed.
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
  })

  test('clear what an interrupted change left behind', async () => {
    // Stopped between its renames: the sample is aside as `.old`, and is moved back.
    fs.renameSync(path.join(samples, 'One'), path.join(samples, '.One.4242.old'))
    write(path.join(samples, '.Two.4242.tmp', 'package.yaml'), 'name: Two\n')
    write(path.join(samples, 'Data', '.rows.csv.4242.tmp'), 'partial')
    await installSamples(bundled, projects)
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
    expect(listing(path.join(samples, 'Data'))).toEqual(['rows.csv'])
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
  })

  test('replace a manifest that cannot be read, taking unknown copies as edited', async () => {
    write(path.join(samples, '.samples.json'), '{ not json')
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updateAvailable: ['One'] })
    expect(manifest().samples).toEqual({
      One: null,
      Two: await hashSample(path.join(bundled, 'Two')),
    })
  })
})

// An install made before manifests: `Samples` holds the old samples, each with its own `data/`,
// and no `Data/` or `Getting_Started`.
describe('installSamples: an install from before manifests', () => {
  beforeEach(() => {
    write(path.join(bundled, 'Getting_Started', 'package.yaml'), 'name: Getting_Started\n')
    write(path.join(samples, 'One', 'package.yaml'), 'name: One\n')
    write(path.join(samples, 'One', 'src', 'Main.enso'), "main = 'data/rows.csv'\n")
    write(path.join(samples, 'One', 'data', 'rows.csv'), 'a,b\n1,2\n')
    write(path.join(samples, 'Two', 'package.yaml'), 'name: Two\n')
    write(path.join(samples, 'Two', 'src', 'Main.enso'), 'main = 2\n')
  })

  test('copies in what is missing, keeps the rest, and records a manifest', async () => {
    expect(await installSamples(bundled, projects)).toEqual({
      installed: false,
      copied: ['Getting_Started', 'Data/rows.csv'],
      updated: [],
      updateAvailable: ['One'],
    })
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe("main = 'data/rows.csv'\n")
    expect(fs.existsSync(path.join(samples, 'One', 'data', 'rows.csv'))).toBe(true)
    expect(read(path.join(samples, 'Data', 'rows.csv'))).toBe('a,b\n1,2\n')
    expect(manifest()).toEqual({
      version: 1,
      samples: {
        // Matches no bundle this version knows: taken as edited, never overwritten.
        One: null,
        // Matches the bundle: current, and updated with it from now on.
        Two: await hashSample(path.join(bundled, 'Two')),
        ['Getting_Started']: await hashSample(path.join(bundled, 'Getting_Started')),
      },
      data: { 'rows.csv': expect.any(String) },
    })
    // A later start leaves the edited one as it is.
    expect(await installSamples(bundled, projects)).toMatchObject({
      copied: [],
      updateAvailable: ['One'],
    })
    expect(await readSamplesManifest(samples)).toEqual(manifest())
  })

  test('an empty Samples gets every sample', async () => {
    fs.rmSync(samples, { recursive: true })
    fs.mkdirSync(samples)
    expect(await installSamples(bundled, projects)).toMatchObject({
      copied: ['Getting_Started', 'One', 'Two', 'Data/rows.csv'],
    })
  })
})

describe('reset', () => {
  let local: LocalSamples
  beforeEach(async () => {
    local = new LocalSamples(bundled, projects)
    await local.sync()
  })

  test('keeps an edited sample as <Name>_edited_<date>, renamed, and copies in the bundle', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    write(path.join(samples, 'One', '.enso', 'project.json'), '{"id":"one-id"}')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')

    expect(await local.reset('One', undefined, NOW)).toEqual({ kept: ['One_edited_2026_11_06'] })
    const kept = path.join(samples, 'One_edited_2026_11_06')
    expect(read(path.join(kept, 'src', 'Main.enso'))).toBe('main = 99\n')
    expect(read(path.join(kept, 'package.yaml'))).toBe('name: One_edited_2026_11_06\n')
    expect(read(path.join(kept, '.enso', 'project.json'))).toBe('{"id":"one-id"}')
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 10\n')
    expect(fs.existsSync(path.join(samples, 'One', '.enso'))).toBe(false)
    expect(manifest().samples['One']).toBe(await hashSample(path.join(bundled, 'One')))
    expect((await local.status()).samples[0]?.state).toBe('current')

    // The same day again: `_2`.
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 98\n')
    expect(await local.reset('One', undefined, NOW)).toEqual({ kept: ['One_edited_2026_11_06_2'] })
    expect(listing(samples)).toEqual([
      '.samples.json',
      'Data',
      'One',
      'One_edited_2026_11_06',
      'One_edited_2026_11_06_2',
      'Two',
    ])
  })

  test('keeps no copy of an unedited sample', async () => {
    expect(await local.reset('Two', undefined, NOW)).toEqual({ kept: [] })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })

  test('brings back a deleted sample', async () => {
    fs.rmSync(path.join(samples, 'Two'), { recursive: true })
    expect(await local.reset('Two', undefined, NOW)).toEqual({ kept: [] })
    expect(read(path.join(samples, 'Two', 'src', 'Main.enso'))).toBe('main = 2\n')
  })

  test('refuses an open sample, and one that is not bundled', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    await expect(local.reset('One', async () => true, NOW)).rejects.toThrow(/is open/)
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 99\n')
    await expect(local.reset('Mine', undefined, NOW)).rejects.toThrow(/not a bundled sample/)
  })
})

describe('resetAll', () => {
  let local: LocalSamples
  beforeEach(async () => {
    local = new LocalSamples(bundled, projects)
    await local.sync()
  })

  test('resets every sample and Data file, keeping edited copies and leaving the rest', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    fs.rmSync(path.join(samples, 'Two'), { recursive: true })
    write(path.join(samples, 'Data', 'rows.csv'), 'mine\n')
    write(path.join(samples, 'Data', 'extra.csv'), 'extra\n')
    write(path.join(samples, 'Mine', 'package.yaml'), 'name: Mine\n')

    expect(await local.resetAll(undefined, NOW)).toEqual({
      kept: ['One_edited_2026_11_06', 'Data/rows_edited_2026_11_06.csv'],
    })
    expect(listing(samples)).toEqual([
      '.samples.json',
      'Data',
      'Mine',
      'One',
      'One_edited_2026_11_06',
      'Two',
    ])
    expect(listing(path.join(samples, 'Data'))).toEqual([
      'extra.csv',
      'rows.csv',
      'rows_edited_2026_11_06.csv',
    ])
    expect(read(path.join(samples, 'Data', 'rows.csv'))).toBe('a,b\n1,2\n')
    expect(read(path.join(samples, 'Data', 'rows_edited_2026_11_06.csv'))).toBe('mine\n')
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
    expect((await local.status()).samples.map((sample) => sample.state)).toEqual([
      'current',
      'current',
    ])
  })

  test('changes nothing while a sample is open', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    await expect(local.resetAll(async (p) => p.endsWith('/Two'), NOW)).rejects.toThrow(
      /'Two' is open/,
    )
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 99\n')
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })

  test('works when Samples is gone', async () => {
    fs.rmSync(samples, { recursive: true })
    expect(await local.resetAll(undefined, NOW)).toEqual({ kept: [] })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })
})
