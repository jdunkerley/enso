/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import type { Path, Uuid } from 'ydoc-shared/languageServerTypes'
import {
  altText,
  IMAGES_FOLDER,
  PROJECT_CHANGED_ERROR,
  serialized,
  STORE_DEADLINE_MARGIN_MS,
  STORED_IMAGE_MAX_BYTES,
  storeImage,
  withProjectId,
  type ImageToolDeps,
} from '../imageTools'

const ROOT = '00000000-0000-0000-0000-000000000001' as Uuid
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const DATA = btoa(String.fromCharCode(...BYTES))

/** Project files over a set of names in `images`; `pickUniqueName` is the test's own stand-in. */
function fakeFiles(existing: string[] = []) {
  const names = new Set(existing)
  const written: { path: Path; size: number }[] = []
  const files = {
    projectRootId: Promise.resolve(ROOT as Uuid | undefined),
    ensureDirExists: vi.fn(async (_path: Path): Promise<Result<void>> => Ok()),
    pickUniqueName: vi.fn(async (_path: Path, name: string): Promise<Result<string>> => {
      let candidate = name
      for (let n = 1; names.has(candidate); n++) candidate = name.replace('.', `_${n}.`)
      return Ok(candidate)
    }),
    writeFileBinary: vi.fn(async (path: Path, blob: Blob): Promise<Result> => {
      written.push({ path, size: blob.size })
      names.add(path.segments.at(-1)!)
      return Ok()
    }),
  }
  return { files, written }
}

function deps(overrides: Partial<ImageToolDeps> = {}): ImageToolDeps {
  return {
    files: fakeFiles().files,
    nodeName: () => 'sales',
    projectId: () => 'p1',
    now: () => 0,
    deadline: 60_000,
    ...overrides,
  }
}

function value(result: McpToolResult) {
  expect(result.ok).toBe(true)
  return JSON.parse(result.ok ? result.value : '')
}

function error(result: McpToolResult) {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

test('the image is written to images/ under the name the existing functions pick', async () => {
  const { files, written } = fakeFiles(['chart.png'])
  const result = await storeImage(deps({ files }), { data: DATA, name: 'chart.png' })
  const folder = { rootId: ROOT, segments: [IMAGES_FOLDER] }
  expect(files.ensureDirExists).toHaveBeenCalledWith(folder)
  expect(files.pickUniqueName).toHaveBeenCalledWith(folder, 'chart.png')
  expect(written).toEqual([
    { path: { rootId: ROOT, segments: ['images', 'chart_1.png'] }, size: BYTES.length },
  ])
  expect(value(result)).toEqual({
    path: '/images/chart_1.png',
    markdown: '![chart_1](/images/chart_1.png)',
    bytes: BYTES.length,
  })
})

test('the path and Markdown are those the documentation editor writes', async () => {
  const result = await storeImage(deps(), { data: DATA, name: 'Sales by region.v2.svg' })
  expect(value(result)).toMatchObject({
    path: '/images/Sales%20by%20region.v2.svg',
    markdown: '![Sales by region.v2](/images/Sales%20by%20region.v2.svg)',
  })
  expect(altText('a[1].png')).toBe('a_1_')
})

test("without a name a picture is named after its node, or 'visualization'", async () => {
  const named = fakeFiles()
  await storeImage(deps({ files: named.files }), { data: DATA, node_id: 'n' })
  expect(named.files.pickUniqueName).toHaveBeenCalledWith(expect.anything(), 'sales.png')
  const unnamed = fakeFiles()
  await storeImage(deps({ files: unnamed.files, nodeName: () => undefined }), {
    data: DATA,
    node_id: 'n',
  })
  expect(unnamed.files.pickUniqueName).toHaveBeenCalledWith(expect.anything(), 'visualization.png')
  // A node named as a Windows device gets a name that is not the device's.
  const device = fakeFiles()
  await storeImage(deps({ files: device.files, nodeName: () => 'con' }), {
    data: DATA,
    node_id: 'n',
  })
  expect(device.files.pickUniqueName).toHaveBeenCalledWith(expect.anything(), '_con.png')
})

test('data that is not base64, or decodes to more than 10 MB, is refused before any file call', async () => {
  const { files } = fakeFiles()
  for (const data of ['', 'abc', 'ab$=', 'YQ===', 'not base64!']) {
    expect(error(await storeImage(deps({ files }), { data, name: 'a.png' })), data).toContain(
      'not base64',
    )
  }
  const tooLarge = 'A'.repeat(Math.ceil((STORED_IMAGE_MAX_BYTES + 1) / 3) * 4)
  expect(error(await storeImage(deps({ files }), { data: tooLarge, name: 'a.png' }))).toContain(
    '10 MB',
  )
  // Exactly the limit decodes.
  const atLimit = 'A'.repeat(Math.floor(STORED_IMAGE_MAX_BYTES / 3) * 4) + 'AA=='
  expect(await storeImage(deps({ files }), { data: atLimit, name: 'a.png' })).toMatchObject({
    ok: true,
  })
  expect(files.writeFileBinary).toHaveBeenCalledTimes(1)
})

test('a name that is not one image file name is refused', async () => {
  const { files } = fakeFiles()
  for (const name of ['../a.png', 'a/b.png', 'a.txt', 'png', '.', 'a?.png', 'NUL.png']) {
    expect(error(await storeImage(deps({ files }), { data: DATA, name })), name).toContain(
      'image name',
    )
  }
  expect(files.ensureDirExists).not.toHaveBeenCalled()
})

test('a failure of the file functions is passed on, and nothing is written after the deadline', async () => {
  const failing = fakeFiles()
  failing.files.ensureDirExists.mockResolvedValue(Err('no access'))
  expect(
    error(await storeImage(deps({ files: failing.files }), { data: DATA, name: 'a.png' })),
  ).toContain('no access')
  expect(failing.written).toEqual([])

  const late = fakeFiles()
  expect(
    error(
      await storeImage(deps({ files: late.files, now: () => 60_000 }), {
        data: DATA,
        name: 'a.png',
      }),
    ),
  ).toContain('timed out')
  expect(late.written).toEqual([])
})

test('within the safety margin of the deadline nothing is created or written', async () => {
  // Too near before anything: not even the folder is created.
  const early = fakeFiles()
  const nearDeadline = 60_000 - STORE_DEADLINE_MARGIN_MS + 1
  const refused = await storeImage(deps({ files: early.files, now: () => nearDeadline }), {
    data: DATA,
    name: 'a.png',
  })
  expect(error(refused)).toContain('timed out')
  expect(early.files.ensureDirExists).not.toHaveBeenCalled()

  // The margin reached while the name was picked: the write is skipped.
  const slow = fakeFiles()
  let clock = 0
  slow.files.pickUniqueName.mockImplementation(async (_path, name) => {
    clock = 60_000 - STORE_DEADLINE_MARGIN_MS
    return Ok(name)
  })
  const late = await storeImage(deps({ files: slow.files, now: () => clock }), {
    data: DATA,
    name: 'a.png',
  })
  expect(error(late)).toContain('timed out')
  expect(slow.files.ensureDirExists).toHaveBeenCalled()
  expect(slow.written).toEqual([])
})

test('serialized stores run one at a time, so two of the same name get different names', async () => {
  const { files, written } = fakeFiles()
  const store = serialized((args: { data: string; name: string }) =>
    storeImage(deps({ files }), args),
  )
  const [first, second] = await Promise.all([
    store({ data: DATA, name: 'a.png' }),
    store({ data: DATA, name: 'a.png' }),
  ])
  expect(value(first).path).toBe('/images/a.png')
  expect(value(second).path).toBe('/images/a_1.png')
  expect(written.map((w) => w.path.segments.at(-1))).toEqual(['a.png', 'a_1.png'])
})

test('a picture is stored only by the project that took it', async () => {
  const other = fakeFiles()
  const refused = await storeImage(deps({ files: other.files, projectId: () => 'p2' }), {
    data: DATA,
    node_id: 'n',
    project_id: 'p1',
  })
  expect(error(refused)).toBe(PROJECT_CHANGED_ERROR)
  expect(other.files.ensureDirExists).not.toHaveBeenCalled()
  expect(other.written).toEqual([])

  const same = fakeFiles()
  const stored = await storeImage(deps({ files: same.files }), {
    data: DATA,
    node_id: 'n',
    project_id: 'p1',
  })
  expect(stored.ok).toBe(true)
  // A file (no first call, so no id) is stored by whichever project is on screen.
  expect(
    (await storeImage(deps({ projectId: () => 'p2' }), { data: DATA, name: 'a.png' })).ok,
  ).toBe(true)
})

test("withProjectId adds the project's id to a JSON answer and leaves a refusal alone", () => {
  const answer = withProjectId({ ok: true, value: JSON.stringify({ node_id: 'n' }, null, 1) }, 'p1')
  expect(JSON.parse(answer.ok ? answer.value : '')).toEqual({ node_id: 'n', project_id: 'p1' })
  const refusal: McpToolResult = { ok: false, error: 'No node n.' }
  expect(withProjectId(refusal, 'p1')).toBe(refusal)
})
