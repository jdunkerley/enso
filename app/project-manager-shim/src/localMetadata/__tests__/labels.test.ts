import { COLORS, LabelName } from 'enso-common/src/services/Backend'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LABELS_FILE_NAME, LocalMetadata } from '../index.js'
import { readPackageLabels, readProjectLabels, writePackageLabels } from '../packageYaml.js'
import { createProject, readProjectJson } from './testUtils.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let root: string
let userData: string
let store: LocalMetadata
let logger: { warn: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-metadata-labels-'))
  userData = path.join(root, 'userData')
  logger = { warn: vi.fn() }
  store = new LocalMetadata({ userDataDirectory: userData, logger })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('label definitions', () => {
  test('an empty store lists no labels and creates no file', async () => {
    expect(await store.listLabels()).toEqual([])
    await expect(fs.access(path.join(userData, LABELS_FILE_NAME))).rejects.toThrow()
  })

  test('created labels round-trip through labels.json', async () => {
    const created = await store.createLabel(LabelName('Finance'), COLORS[2])
    expect(created.id).toMatch(UUID_REGEX)
    expect(created).toMatchObject({ value: 'Finance', color: COLORS[2] })
    expect(await store.listLabels()).toEqual([created])
    const reopened = new LocalMetadata({ userDataDirectory: userData, logger })
    expect(await reopened.listLabels()).toEqual([created])
    const file = JSON.parse(await fs.readFile(path.join(userData, LABELS_FILE_NAME), 'utf8'))
    expect(file).toMatchObject({ version: 1, labels: [created] })
  })

  test('a duplicate value is rejected; names are case-sensitive', async () => {
    await store.createLabel(LabelName('a'), COLORS[0])
    await expect(store.createLabel(LabelName('a'), COLORS[1])).rejects.toThrow(/already exists/)
    await store.createLabel(LabelName('A'), COLORS[1])
    expect((await store.listLabels()).map((label) => label.value)).toEqual(['a', 'A'])
  })

  test('an empty value is rejected', async () => {
    await expect(store.createLabel(LabelName('  '), COLORS[0])).rejects.toThrow()
  })

  test('concurrent creates are all kept', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.createLabel(LabelName(`l${i}`), COLORS[0])),
    )
    expect(await store.listLabels()).toHaveLength(10)
  })

  test('deleting a label removes it', async () => {
    const a = await store.createLabel(LabelName('a'), COLORS[0])
    const b = await store.createLabel(LabelName('b'), COLORS[1])
    await store.deleteLabel(a.id)
    expect(await store.listLabels()).toEqual([b])
  })

  test('deleting an unknown id is a no-op', async () => {
    await store.deleteLabel('nope')
    expect(await store.listLabels()).toEqual([])
  })

  test('a corrupt labels.json is moved aside and reads as empty', async () => {
    await fs.mkdir(userData, { recursive: true })
    await fs.writeFile(path.join(userData, LABELS_FILE_NAME), 'not json')
    expect(await store.listLabels()).toEqual([])
    const names = await fs.readdir(userData)
    expect(names.some((name) => name.startsWith(`${LABELS_FILE_NAME}.corrupt-`))).toBe(true)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  test('a labels.json from a newer version is moved aside', async () => {
    await fs.mkdir(userData, { recursive: true })
    await fs.writeFile(
      path.join(userData, LABELS_FILE_NAME),
      JSON.stringify({ version: 99, labels: [] }),
    )
    expect(await store.listLabels()).toEqual([])
    const names = await fs.readdir(userData)
    expect(names.some((name) => name.startsWith(`${LABELS_FILE_NAME}.newer-`))).toBe(true)
  })
})

describe('resolveLabelNames', () => {
  test('keeps live names, drops deleted ones, and adds unknown ones', async () => {
    await store.createLabel(LabelName('live'), COLORS[0])
    const gone = await store.createLabel(LabelName('gone'), COLORS[1])
    await store.deleteLabel(gone.id)

    const resolved = await store.resolveLabelNames(['live', 'gone', 'fresh'])
    expect([...resolved].sort()).toEqual(['fresh', 'live'])

    const labels = await store.listLabels()
    expect(labels.map((label) => label.value)).toEqual(['live', 'fresh'])
    // `COLORS[0]` is used once, so the least-used colour is the next one.
    expect(labels[1]?.color).toEqual(COLORS[1])
  })

  test('re-creating a deleted label makes the name live again', async () => {
    const gone = await store.createLabel(LabelName('x'), COLORS[0])
    await store.deleteLabel(gone.id)
    expect([...(await store.resolveLabelNames(['x']))]).toEqual([])
    await store.createLabel(LabelName('x'), COLORS[3])
    expect([...(await store.resolveLabelNames(['x']))]).toEqual(['x'])
  })

  test('does not write labels.json when nothing is unknown', async () => {
    expect([...(await store.resolveLabelNames([]))]).toEqual([])
    await expect(fs.access(path.join(userData, LABELS_FILE_NAME))).rejects.toThrow()
  })
})

describe('setProjectLabels', () => {
  test('writes package.yaml, not project.json, and keeps every other field', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1', {
      lastOpened: '2026-02-02T00:00:00.000Z',
      extra: { keep: true },
    })
    await store.createLabel(LabelName('a'), COLORS[0])
    await store.setProjectLabels(project, ['a'])
    expect(await readPackageLabels(project)).toEqual(['a'])
    expect(await readProjectJson(project)).toEqual({
      id: 'id-1',
      kind: 'UserProject',
      created: '2026-01-01T00:00:00.000Z',
      lastOpened: '2026-02-02T00:00:00.000Z',
      extra: { keep: true },
    })
  })

  test('drops deleted names, de-duplicates, and adds unknown names', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1')
    const gone = await store.createLabel(LabelName('gone'), COLORS[0])
    await store.deleteLabel(gone.id)
    await store.setProjectLabels(project, ['new', 'gone', 'new'])
    expect(await readPackageLabels(project)).toEqual(['new'])
    expect((await store.listLabels()).map((label) => label.value)).toEqual(['new'])
  })

  test('an empty list removes the field', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1', { labels: ['a'] })
    await writePackageLabels(project, ['a'])
    await store.setProjectLabels(project, [])
    expect(await readPackageLabels(project)).toEqual([])
    expect(await readProjectJson(project)).not.toHaveProperty('labels')
  })

  test('labels left in project.json are removed when package.yaml is written', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1', { labels: ['old'] })
    await store.setProjectLabels(project, ['a'])
    expect(await readPackageLabels(project)).toEqual(['a'])
    expect(await readProjectJson(project)).not.toHaveProperty('labels')
  })

  test('rejects a path that is not a project', async () => {
    await fs.mkdir(path.join(root, 'plain'))
    await expect(store.setProjectLabels(path.join(root, 'plain'), ['a'])).rejects.toThrow()
    await expect(fs.access(path.join(root, 'plain', '.enso'))).rejects.toThrow()
  })

  test('rejects a corrupt project.json without moving it', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1')
    await writePackageLabels(project, ['keep'])
    const yamlBefore = await fs.readFile(path.join(project, 'package.yaml'), 'utf8')
    await fs.writeFile(path.join(project, '.enso', 'project.json'), '{bad')
    await expect(store.setProjectLabels(project, ['a'])).rejects.toThrow()
    expect(await fs.readFile(path.join(project, '.enso', 'project.json'), 'utf8')).toBe('{bad')
    expect(await fs.readFile(path.join(project, 'package.yaml'), 'utf8')).toBe(yamlBefore)
  })
})

describe('readProjectLabels', () => {
  test('labels left in project.json move to package.yaml on read', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1', { labels: ['old'] })
    expect(await readProjectLabels(project)).toEqual(['old'])
    expect(await readPackageLabels(project)).toEqual(['old'])
    expect(await readProjectJson(project)).not.toHaveProperty('labels')
  })

  test("package.yaml's labels win over project.json's", async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1', { labels: ['old'] })
    await writePackageLabels(project, ['new'])
    expect(await readProjectLabels(project)).toEqual(['new'])
    expect(await readProjectJson(project)).not.toHaveProperty('labels')
  })

  test('a project without labels anywhere has none and project.json is untouched', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1')
    const before = await fs.readFile(path.join(project, '.enso', 'project.json'), 'utf8')
    expect(await readProjectLabels(project)).toEqual([])
    expect(await fs.readFile(path.join(project, '.enso', 'project.json'), 'utf8')).toBe(before)
  })
})
