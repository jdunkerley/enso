import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  compareSample,
  ensoCodeForHash,
  fileOps,
  hashSample,
  installSamples,
  LocalSamples,
  markProjectRunning,
  readSamplesManifest,
  Unreadable,
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
    // The first check records the files' hashes for the next ones.
    await installSamples(bundled, projects)
    expect(Object.keys(manifest().files ?? {}).sort()).toEqual([
      'Data/rows.csv',
      'One/package.yaml',
      'One/src/Main.enso',
      'Two/package.yaml',
      'Two/src/Main.enso',
    ])
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
    expect(manifest()).toMatchObject({
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
    // The bundle is read once per `LocalSamples`; a new version is a new one.
    local = new LocalSamples(bundled, projects)

    expect(await local.reset('One', undefined, NOW)).toEqual({
      kept: ['One_edited_2026_11_06'],
      unrenamed: [],
    })
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
    expect(await local.reset('One', undefined, NOW)).toEqual({
      kept: ['One_edited_2026_11_06_2'],
      unrenamed: [],
    })
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
    expect(await local.reset('Two', undefined, NOW)).toEqual({ kept: [], unrenamed: [] })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })

  test('brings back a deleted sample', async () => {
    fs.rmSync(path.join(samples, 'Two'), { recursive: true })
    expect(await local.reset('Two', undefined, NOW)).toEqual({ kept: [], unrenamed: [] })
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
      unrenamed: [],
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
    expect(await local.resetAll(undefined, NOW)).toEqual({ kept: [], unrenamed: [] })
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
  })
})

describe('the code of an .enso file', () => {
  const MAIN = 'main =\n    1\n'
  const WITH_METADATA = `${MAIN}\n\n\n#### METADATA ####\n[[{"index":{"value":7}}],"{}"]\n`

  test('leaves out the METADATA section and the line endings', () => {
    expect(ensoCodeForHash(WITH_METADATA)).toBe(ensoCodeForHash(`${MAIN}\n\n`))
    expect(ensoCodeForHash(WITH_METADATA.replace(/\n/g, '\r\n'))).toBe(
      ensoCodeForHash(WITH_METADATA),
    )
    expect(ensoCodeForHash(MAIN)).not.toBe(ensoCodeForHash('main =\n    2\n'))
  })

  test('so rewritten metadata is not an edit, and an update replaces the whole file', async () => {
    write(path.join(bundled, 'One', 'src', 'Main.enso'), WITH_METADATA)
    await installSamples(bundled, projects)
    const main = path.join(samples, 'One', 'src', 'Main.enso')
    // What opening the sample in the IDE does: new node positions and widget state, CRLF.
    write(main, WITH_METADATA.replace('"value":7', '"value":8').replace(/\n/g, '\r\n'))
    expect((await new LocalSamples(bundled, projects).status()).samples[0]?.state).toBe('current')

    // An update brings the new code and the new METADATA.
    const updated = WITH_METADATA.replace('1\n', '10\n').replace('"value":7', '"value":9')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), updated)
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
    expect(read(main)).toBe(updated)
  })
})

describe('what cannot be read', () => {
  beforeEach(async () => {
    await installSamples(bundled, projects)
  })

  function failStat(target: string, code: string) {
    const stat = fs.promises.stat
    vi.spyOn(fs.promises, 'stat').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) =>
      path.resolve(String(p)) === path.resolve(target) ?
        Promise.reject(Object.assign(new Error(`${code}: ${String(p)}`), { code }))
      : (stat as (...args: unknown[]) => Promise<fs.Stats>)(p, ...rest)) as typeof fs.promises.stat)
  }

  test('a Data file that cannot be read (EACCES) is never overwritten; Reset All keeps it', async () => {
    const rows = path.join(samples, 'Data', 'rows.csv')
    write(rows, 'mine\n')
    write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n3,4\n')
    failStat(rows, 'EACCES')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // No manifest record either: the case that took the install branch before.
    fs.writeFileSync(
      path.join(samples, '.samples.json'),
      JSON.stringify({ ...manifest(), data: {} }),
    )
    await installSamples(bundled, projects)
    expect(read(rows)).toBe('mine\n')

    expect(await new LocalSamples(bundled, projects).resetAll(undefined, NOW)).toMatchObject({
      kept: ['Data/rows_edited_2026_11_06.csv'],
    })
    vi.restoreAllMocks()
    expect(read(path.join(samples, 'Data', 'rows_edited_2026_11_06.csv'))).toBe('mine\n')
    expect(read(rows)).toBe('a,b\n3,4\n')
  })

  test('a folder where a Data file should be (EISDIR) is left alone; Reset All keeps it', async () => {
    const rows = path.join(samples, 'Data', 'rows.csv')
    fs.rmSync(rows)
    write(path.join(rows, 'inside.txt'), 'x')
    fs.writeFileSync(
      path.join(samples, '.samples.json'),
      JSON.stringify({ ...manifest(), data: {} }),
    )
    await installSamples(bundled, projects)
    expect(fs.statSync(rows).isDirectory()).toBe(true)

    await new LocalSamples(bundled, projects).resetAll(undefined, NOW)
    expect(read(path.join(samples, 'Data', 'rows_edited_2026_11_06.csv', 'inside.txt'))).toBe('x')
    expect(read(rows)).toBe('a,b\n1,2\n')
  })

  test('an unreadable sample is reported as such, the others still are, and Reset keeps it', async () => {
    const one = path.join(samples, 'One')
    failStat(one, 'EACCES')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    write(path.join(bundled, 'Two', 'src', 'Main.enso'), 'main = 20\n')
    const local = new LocalSamples(bundled, projects)
    expect(await local.sync()).toMatchObject({ updated: ['Two'] })
    expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 1\n')
    expect((await local.status()).samples.map((sample) => sample.state)).toEqual([
      'unreadable',
      'current',
    ])
    expect(await local.reset('One', undefined, NOW)).toEqual({
      kept: ['One_edited_2026_11_06'],
      unrenamed: [],
    })
    vi.restoreAllMocks()
    expect(read(path.join(samples, 'One_edited_2026_11_06', 'src', 'Main.enso'))).toBe('main = 1\n')
    expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 10\n')
  })

  test('a large file is hashed as a stream, not read whole', async () => {
    const readFile = fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) =>
      String(p).endsWith('.csv') ?
        Promise.reject(
          Object.assign(new RangeError('File size is greater than 2 GiB'), {
            code: 'ERR_FS_FILE_TOO_LARGE',
          }),
        )
      : (readFile as (...args: unknown[]) => Promise<unknown>)(
          p,
          ...rest,
        )) as typeof fs.promises.readFile)
    write(path.join(bundled, 'Data', 'rows.csv'), 'a,b\n3,4\n')
    expect(await new LocalSamples(bundled, projects).sync()).toMatchObject({
      updated: ['Data/rows.csv'],
    })
  })

  test('a file whose size and time did not change is not read again', async () => {
    await installSamples(bundled, projects)
    const readFile = vi.spyOn(fs.promises, 'readFile')
    await new LocalSamples(bundled, projects).status()
    const paths = readFile.mock.calls.map(([p]) => path.resolve(String(p)))
    expect(paths).not.toContain(path.resolve(samples, 'One', 'src', 'Main.enso'))
    expect(paths).toContain(path.resolve(bundled, 'One', 'src', 'Main.enso'))
  })

  test('compareSample keeps an unreadable copy and its record', () => {
    expect(compareSample('B', new Unreadable(new Error('EACCES')), 'A')).toEqual({
      action: 'keep',
      record: 'A',
      state: 'unreadable',
    })
  })
})

describe('open samples', () => {
  beforeEach(async () => {
    await installSamples(bundled, projects)
  })

  test('a sample another process runs (its run marker) is neither updated nor reset', async () => {
    const one = path.join(samples, 'One')
    const unmark = await markProjectRunning(one)
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    const local = new LocalSamples(bundled, projects)
    expect(await local.sync()).toMatchObject({ updated: [], updateAvailable: ['One'] })
    await expect(local.reset('One', undefined, NOW)).rejects.toThrow(/is open/)
    await expect(local.resetAll(undefined, NOW)).rejects.toThrow(/is open/)
    expect(read(path.join(one, 'src', 'Main.enso'))).toBe('main = 1\n')
    await unmark()
    expect(await local.sync()).toMatchObject({ updated: ['One'] })
  })

  test('a marker left by a process that has gone is ignored', async () => {
    write(path.join(samples, 'One', '.enso', 'run-999999999.lock'), '')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
  })
})

describe('a manifest from a newer version', () => {
  beforeEach(async () => {
    await installSamples(bundled, projects)
    fs.rmSync(path.join(samples, 'Two'), { recursive: true })
    fs.writeFileSync(path.join(samples, '.samples.json'), JSON.stringify({ version: 2 }))
  })

  test('is left alone, and so are the samples', async () => {
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    const local = new LocalSamples(bundled, projects)
    expect(await local.sync()).toEqual({
      installed: false,
      copied: [],
      updated: [],
      updateAvailable: [],
    })
    expect(read(path.join(samples, '.samples.json'))).toBe('{"version":2}')
    expect(fs.existsSync(path.join(samples, 'Two'))).toBe(false)
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
    expect((await local.status()).samples.map((sample) => sample.state)).toEqual([
      'edited',
      'missing',
    ])
    await expect(local.reset('One', undefined, NOW)).rejects.toThrow(/newer version/)
  })
})

describe('local state on update', () => {
  test("the user's copy of a file the bundle ships in output/ wins", async () => {
    await installSamples(bundled, projects)
    write(path.join(samples, 'One', 'output', 'README.txt'), 'my notes\n')
    write(path.join(bundled, 'One', 'output', 'README.txt'), 'new outputs\n')
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
    expect(read(path.join(samples, 'One', 'output', 'README.txt'))).toBe('my notes\n')
  })
})

describe('a rename that fails', () => {
  beforeEach(async () => {
    await installSamples(bundled, projects)
  })

  function failRename(when: (from: string, to: string) => boolean) {
    const rename = fileOps.rename
    vi.spyOn(fileOps, 'rename').mockImplementation((from, to) =>
      when(from, to) ? Promise.reject(new Error('EBUSY: rename')) : rename(from, to),
    )
  }

  test('during an update leaves the sample as it was, and the next start tries again', async () => {
    write(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 10\n')
    const recorded = manifest().samples['One']
    failRename((from) => path.basename(from).endsWith('.tmp'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await new LocalSamples(bundled, projects).sync()).toMatchObject({ updated: [] })
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 1\n')
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
    expect(manifest().samples['One']).toBe(recorded)
    vi.mocked(fileOps.rename).mockRestore()
    expect(await installSamples(bundled, projects)).toMatchObject({ updated: ['One'] })
  })

  test('during a reset puts the edited sample back, with its name', async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    failRename((from, to) => path.basename(from).startsWith('.One.') && path.basename(to) === 'One')
    await expect(new LocalSamples(bundled, projects).reset('One', undefined, NOW)).rejects.toThrow(
      'EBUSY',
    )
    expect(listing(samples)).toEqual(['.samples.json', 'Data', 'One', 'Two'])
    expect(read(path.join(samples, 'One', 'src', 'Main.enso'))).toBe('main = 99\n')
    expect(read(path.join(samples, 'One', 'package.yaml'))).toBe('name: One\n')
  })

  test("of the edited copy's package.yaml is reported, and the copy is still kept", async () => {
    write(path.join(samples, 'One', 'src', 'Main.enso'), 'main = 99\n')
    failRename((_from, to) => path.basename(to) === 'package.yaml')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await new LocalSamples(bundled, projects).reset('One', undefined, NOW)).toEqual({
      kept: ['One_edited_2026_11_06'],
      unrenamed: ['One_edited_2026_11_06'],
    })
    expect(read(path.join(samples, 'One_edited_2026_11_06', 'package.yaml'))).toBe('name: One\n')
    expect(listing(path.join(samples, 'One_edited_2026_11_06'))).toEqual([
      'output',
      'package.yaml',
      'src',
    ])
  })
})
