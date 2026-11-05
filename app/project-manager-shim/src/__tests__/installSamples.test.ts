import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installSamples } from '../projectManagement.js'

let root: string
let bundled: string
let projects: string

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-samples-'))
  bundled = path.join(root, 'resources', 'samples')
  projects = path.join(root, 'projects')
  fs.mkdirSync(path.join(bundled, 'One', 'src'), { recursive: true })
  fs.mkdirSync(path.join(bundled, 'One', 'data'), { recursive: true })
  fs.writeFileSync(path.join(bundled, 'One', 'package.yaml'), 'name: One\n')
  fs.writeFileSync(path.join(bundled, 'One', 'src', 'Main.enso'), 'main = 1\n')
  fs.writeFileSync(path.join(bundled, 'One', 'data', 'rows.csv'), 'a,b\n1,2\n')
  fs.mkdirSync(path.join(bundled, 'Two'), { recursive: true })
  fs.writeFileSync(path.join(bundled, 'Two', 'package.yaml'), 'name: Two\n')
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('installSamples', () => {
  test('copies the bundled projects into <projects>/Samples when it is missing', async () => {
    expect(await installSamples(bundled, projects)).toBe(true)
    const samples = path.join(projects, 'Samples')
    expect(fs.readdirSync(samples).sort()).toEqual(['One', 'Two'])
    expect(fs.readFileSync(path.join(samples, 'One', 'src', 'Main.enso'), 'utf8')).toBe(
      'main = 1\n',
    )
    expect(fs.readFileSync(path.join(samples, 'One', 'data', 'rows.csv'), 'utf8')).toBe(
      'a,b\n1,2\n',
    )
    // No staging directory is left behind.
    expect(fs.readdirSync(projects)).toEqual(['Samples'])
  })

  test('copies only once: a second start, and a changed copy, are left alone', async () => {
    expect(await installSamples(bundled, projects)).toBe(true)
    const edited = path.join(projects, 'Samples', 'One', 'src', 'Main.enso')
    fs.writeFileSync(edited, 'main = 2\n')
    fs.rmSync(path.join(projects, 'Samples', 'Two'), { recursive: true })

    expect(await installSamples(bundled, projects)).toBe(false)
    expect(fs.readFileSync(edited, 'utf8')).toBe('main = 2\n')
    expect(fs.existsSync(path.join(projects, 'Samples', 'Two'))).toBe(false)
  })

  test('is skipped when Samples exists, even when empty', async () => {
    fs.mkdirSync(path.join(projects, 'Samples'), { recursive: true })
    expect(await installSamples(bundled, projects)).toBe(false)
    expect(fs.readdirSync(path.join(projects, 'Samples'))).toEqual([])
  })

  test.each([undefined, 'missing'])('installs nothing when the bundle is %s', async (dir) => {
    const source = dir && path.join(root, dir)
    expect(await installSamples(source, projects)).toBe(false)
    expect(fs.existsSync(path.join(projects, 'Samples'))).toBe(false)
  })
})
