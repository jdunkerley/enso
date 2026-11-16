/** @file Tests for the `add_image` tool's main half (`src/mcp/imageTool.ts`). */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { fsImageFiles, IMAGE_MAX_BYTES, imageTool, type ImageFiles } from '../../src/mcp/imageTool'
import type { CapturedImage } from '../../src/mcp/visualizationTool'
import { EDIT_TOOL_TIMEOUT_MS } from '../../src/mcp/windowBridge'

const CALLER: McpCaller = { kind: 'external', name: 'test' }

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR', 'ascii'),
  Buffer.from([0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0]),
])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0])
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1')
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'ascii'),
  Buffer.alloc(8),
])
/** An `ftyp` box whose major brand is `mif1` and whose compatible brands include `avif`. */
const AVIF = Buffer.concat([
  Buffer.from([0, 0, 0, 0x1c]),
  Buffer.from('ftypmif1', 'ascii'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('mif1avifmiaf', 'ascii'),
  Buffer.alloc(8),
])
const SVG = Buffer.from(
  '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- Created by an agent -->\n' +
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n',
  'utf8',
)

interface FakeFile {
  readonly bytes?: Buffer
  readonly size?: number
  readonly directory?: boolean
}

/** Files by path; `reads` lists the paths whose content was read. */
function fakeFiles(files: Record<string, FakeFile>): ImageFiles & { reads: string[] } {
  const reads: string[] = []
  const missing = () => Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  return {
    reads,
    stat: async (path) => {
      const file = files[path]
      if (file == null) throw missing()
      return { isFile: () => !file.directory, size: file.size ?? file.bytes?.length ?? 0 }
    },
    read: async (path, maxBytes) => {
      reads.push(path)
      const file = files[path]
      if (file == null) throw missing()
      return (file.bytes ?? Buffer.alloc(0)).subarray(0, maxBytes + 1)
    },
  }
}

/** A PNG header for an image of that size. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.from(PNG)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function capturedImage(width: number, height: number): CapturedImage {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (options) => capturedImage(options.width, options.height),
    toPNG: () => png(width, height),
  }
}

const STORED: McpToolResult = {
  ok: true,
  value: JSON.stringify({ path: '/images/a.png', markdown: '![a](/images/a.png)', bytes: 1 }),
}

function tool(
  files: Record<string, FakeFile> = {},
  window: (tool: string, args: Record<string, unknown>) => McpToolResult = () => STORED,
  platform: NodeJS.Platform = process.platform,
) {
  const calls: { tool: string; args: Record<string, unknown>; timeoutMs: number | undefined }[] = []
  const fake = fakeFiles(files)
  const definition = imageTool(
    {
      call: async (name, args, _caller, timeoutMs) => {
        calls.push({ tool: name, args, timeoutMs })
        return window(name, args)
      },
    },
    async () => capturedImage(300, 200),
    fake,
    async () => {},
    platform,
  )
  return { definition, calls, reads: fake.reads }
}

function errorOf(result: McpToolResult): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.error
}

const ROOT = process.platform === 'win32' ? 'C:\\charts\\' : '/charts/'

test.each([
  ['chart.png', PNG],
  ['chart.apng', PNG],
  ['chart.jpg', JPEG],
  ['chart.JPEG', JPEG],
  ['chart.gif', GIF],
  ['chart.webp', WEBP],
  ['chart.avif', AVIF],
  ['chart.svg', SVG],
])('%s is stored under its own name, its bytes sent as base64', async (file, bytes) => {
  const path = ROOT + file
  const { definition, calls } = tool({ [path]: { bytes } })
  expect(await definition.run({ path }, CALLER)).toEqual(STORED)
  expect(calls).toEqual([
    {
      tool: 'store_image',
      args: { data: bytes.toString('base64'), name: file },
      timeoutMs: EDIT_TOOL_TIMEOUT_MS,
    },
  ])
})

test('an SVG may start with a comment, and with an XML declaration only before it', async () => {
  const path = ROOT + 'a.svg'
  const svg = Buffer.from('  <!-- a --> <svg/>')
  expect((await tool({ [path]: { bytes: svg } }).definition.run({ path }, CALLER)).ok).toBe(true)
  for (const text of [
    '<!-- a --><?xml version="1.0"?><svg/>',
    '<html><svg/></html>',
    'svg',
    '<svgx/>',
    '<!-- unterminated <svg/>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
    '<!DOCTYPE html><svg/>',
  ]) {
    const result = await tool({ [path]: { bytes: Buffer.from(text) } }).definition.run(
      { path },
      CALLER,
    )
    expect(errorOf(result), text).toContain('not an SVG image')
  }
})

test('content that does not match the extension is refused, and none of it is quoted', async () => {
  const text = ROOT + 'notes.png'
  const secret = Buffer.from('password=hunter2\n')
  const { definition, calls } = tool({ [text]: { bytes: secret } })
  const error = errorOf(await definition.run({ path: text }, CALLER))
  expect(error).toContain('not a PNG image')
  expect(error).not.toContain('hunter2')
  expect(calls).toEqual([])

  // A PNG named .jpg: refused, saying what it is, rather than stored under the wrong kind.
  const misnamed = ROOT + 'chart.jpg'
  const other = tool({ [misnamed]: { bytes: PNG } })
  const misnamedError = errorOf(await other.definition.run({ path: misnamed }, CALLER))
  expect(misnamedError).toContain('not a JPEG image')
  expect(misnamedError).toContain('PNG')
  expect(other.calls).toEqual([])
})

test('an extension that is not an image kind is refused before anything is read', async () => {
  for (const file of ['notes.txt', 'archive', 'chart.png.exe', 'chart.jfif']) {
    const path = ROOT + file
    const { definition, reads } = tool({ [path]: { bytes: PNG } })
    expect(errorOf(await definition.run({ path }, CALLER))).toContain('extension')
    expect(reads).toEqual([])
  }
})

test('a file over 10 MB is refused from its size, without reading it', async () => {
  const path = ROOT + 'big.png'
  const { definition, reads, calls } = tool({ [path]: { bytes: PNG, size: IMAGE_MAX_BYTES + 1 } })
  expect(errorOf(await definition.run({ path }, CALLER))).toContain('10 MB')
  expect(reads).toEqual([])
  expect(calls).toEqual([])
  // Exactly the limit is accepted.
  const ok = tool({ [path]: { bytes: PNG, size: IMAGE_MAX_BYTES } })
  expect((await ok.definition.run({ path }, CALLER)).ok).toBe(true)
})

test('a file that grew past 10 MB after its size was read is refused', async () => {
  const path = ROOT + 'growing.png'
  const bytes = Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)])
  const { definition, calls } = tool({ [path]: { bytes, size: 100 } })
  expect(errorOf(await definition.run({ path }, CALLER))).toContain('10 MB')
  expect(calls).toEqual([])
})

test('a directory, a missing file and a relative path are refused', async () => {
  const folder = ROOT + 'folder.png'
  const { definition, reads } = tool({ [folder]: { directory: true } })
  expect(errorOf(await definition.run({ path: folder }, CALLER))).toContain('not a regular file')
  expect(reads).toEqual([])
  expect(errorOf(await definition.run({ path: ROOT + 'missing.png' }, CALLER))).toContain('no file')
  for (const relative of ['chart.png', 'charts/chart.png', './chart.png', '../chart.png']) {
    expect(errorOf(await definition.run({ path: relative }, CALLER))).toMatch(/absolute|full path/)
  }
})

test('exactly one of path and node_id', async () => {
  const { definition, calls } = tool()
  expect(errorOf(await definition.run({}, CALLER))).toContain('exactly one')
  expect(errorOf(await definition.run({ path: ROOT + 'a.png', node_id: 'n' }, CALLER))).toContain(
    'exactly one',
  )
  expect(calls).toEqual([])
})

test('bad names are refused, each saying why', async () => {
  const path = ROOT + 'chart.png'
  const { definition, calls, reads } = tool({ [path]: { bytes: PNG } })
  const cases: [string, string][] = [
    ['sub/chart.png', 'without folders'],
    ['..\\chart.png', 'without folders'],
    ['chart?.png', 'only'],
    ['grafik-ü.png', 'only'],
    ['...', 'letter'],
    ['   ', 'letter'],
    ['NUL.png', 'reserves'],
    ['com1', 'reserves'],
  ]
  for (const [name, why] of cases) {
    expect(errorOf(await definition.run({ path, name }, CALLER)), name).toContain(why)
  }
  expect(calls).toEqual([])
  expect(reads).toEqual([])
})

test("the name's extension is forced to the image's kind", async () => {
  const cases: [string, Buffer, string | undefined, string][] = [
    ['chart.png', PNG, 'Sales by region', 'Sales by region.png'],
    ['chart.png', PNG, 'sales.v2', 'sales.v2.png'],
    ['chart.jpeg', JPEG, 'sales.png', 'sales.jpeg'],
    ['chart.jpeg', JPEG, 'sales.JPG', 'sales.JPG'],
    ['chart.svg', SVG, 'diagram.gif', 'diagram.svg'],
    // The source's own name, with characters outside the rule replaced.
    ['Q1 (final) ü.png', PNG, undefined, 'Q1 _final_ _.png'],
  ]
  for (const [file, bytes, name, stored] of cases) {
    const path = ROOT + file
    const { definition, calls } = tool({ [path]: { bytes } })
    await definition.run({ path, ...(name != null ? { name } : {}) }, CALLER)
    expect(calls[0]?.args.name, `${file} as ${name}`).toBe(stored)
  }
})

test('a capture is stored as PNG and its result carries shown and moved', async () => {
  const prepared = {
    node_id: 'n',
    visualization: 'Table',
    shown: true,
    changed: false,
    moved: true,
    available: ['Table'],
    rect: { x: 0, y: 0, width: 300, height: 200 },
  }
  const { definition, calls } = tool({}, (name) =>
    name === 'prepare_visualization' ? { ok: true, value: JSON.stringify(prepared) } : STORED,
  )
  const result = await definition.run({ node_id: 'n' }, CALLER)
  expect(calls.map((c) => [c.tool, c.timeoutMs])).toEqual([
    ['prepare_visualization', EDIT_TOOL_TIMEOUT_MS],
    ['store_image', EDIT_TOOL_TIMEOUT_MS],
  ])
  expect(calls[0]!.args).toEqual({ node_id: 'n' })
  // No name: the window names it after the node.
  expect(calls[1]!.args).toEqual({ data: png(300, 200).toString('base64'), node_id: 'n' })
  expect(result.ok).toBe(true)
  expect(JSON.parse(result.ok ? result.value : '')).toEqual({
    path: '/images/a.png',
    markdown: '![a](/images/a.png)',
    bytes: 1,
    shown: true,
    moved: true,
  })

  const named = tool({}, (name) =>
    name === 'prepare_visualization' ? { ok: true, value: JSON.stringify(prepared) } : STORED,
  )
  await named.definition.run({ node_id: 'n', name: 'totals.jpg' }, CALLER)
  expect(named.calls[1]!.args).toEqual({
    data: png(300, 200).toString('base64'),
    name: 'totals.png',
  })
})

test("the window's refusal is passed on; after a capture that showed the visualization it says so", async () => {
  const refusal: McpToolResult = { ok: false, error: 'The project has no files.' }
  const path = ROOT + 'chart.png'
  const { definition } = tool({ [path]: { bytes: PNG } }, () => refusal)
  expect(await definition.run({ path }, CALLER)).toEqual(refusal)

  const prepareRefusal: McpToolResult = { ok: false, error: 'No node n.' }
  const failing = tool({}, () => prepareRefusal)
  expect(await failing.definition.run({ node_id: 'n' }, CALLER)).toEqual(prepareRefusal)

  const prepared = {
    node_id: 'n',
    visualization: 'Table',
    shown: true,
    changed: false,
    moved: false,
    available: ['Table'],
    rect: { x: 0, y: 0, width: 300, height: 200 },
  }
  const shown = tool({}, (name) =>
    name === 'prepare_visualization' ? { ok: true, value: JSON.stringify(prepared) } : refusal,
  )
  const error = errorOf(await shown.definition.run({ node_id: 'n' }, CALLER))
  expect(error).toContain('The project has no files.')
  expect(error).toContain('set_visualization')
})

const dir = mkdtempSync(join(tmpdir(), 'enso-mcp-image-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('the real file reader reads a regular file and refuses a directory', async () => {
  const file = join(dir, 'a.png')
  writeFileSync(file, PNG)
  mkdirSync(join(dir, 'folder.png'))
  const files = fsImageFiles()
  expect((await files.stat(file)).isFile()).toBe(true)
  expect(await files.read(file, IMAGE_MAX_BYTES)).toEqual(PNG)
  expect((await files.stat(join(dir, 'folder.png'))).isFile()).toBe(false)
  await expect(files.read(join(dir, 'folder.png'), IMAGE_MAX_BYTES)).rejects.toThrow()
  // It reads at most one byte past the limit.
  expect((await files.read(file, 4)).length).toBe(5)

  // End to end through the tool, with a window that accepts everything.
  const definition = imageTool(
    { call: async () => STORED },
    async () => null,
    files,
    async () => {},
  )
  expect(errorOf(await definition.run({ path: join(dir, 'folder.png') }, CALLER))).toContain(
    'not a regular file',
  )
  expect((await definition.run({ path: file }, CALLER)).ok).toBe(true)
})

const NOT_LOCAL_ERROR =
  'Give the full path of a file on this computer, such as C:\\charts\\sales.png; ' +
  'network and device paths are not accepted.'

test('on Windows only a drive path is taken: network, device and drive-relative paths are refused', async () => {
  const refused = [
    String.raw`\\host\share\x.png`,
    String.raw`\\.\pipe\x.png`,
    String.raw`\\?\C:\charts\x.png`,
    '//host/share/x.png',
    String.raw`\charts\x.png`,
    '/charts/x.png',
    'C:x.png',
    'x.png',
  ]
  for (const path of refused) {
    const { definition, reads } = tool({ [path]: { bytes: PNG } }, () => STORED, 'win32')
    expect(errorOf(await definition.run({ path }, CALLER)), path).toBe(NOT_LOCAL_ERROR)
    expect(reads, path).toEqual([])
  }
  for (const path of [String.raw`C:\charts\x.png`, 'd:/charts/x.png']) {
    const { definition, calls } = tool({ [path]: { bytes: PNG } }, () => STORED, 'win32')
    expect((await definition.run({ path }, CALLER)).ok, path).toBe(true)
    expect(calls[0]?.args.name, path).toBe('x.png')
  }
})

test('elsewhere an absolute path is taken, and a relative one refused', async () => {
  const path = '/home/user/charts/x.png'
  const { definition } = tool({ [path]: { bytes: PNG } }, () => STORED, 'linux')
  expect((await definition.run({ path }, CALLER)).ok).toBe(true)
  expect(errorOf(await definition.run({ path: 'charts/x.png' }, CALLER))).toContain('absolute')
})

test('an AVIF brand past the first 256 bytes of the ftyp box is not looked for', async () => {
  const box = Buffer.alloc(400)
  box.writeUInt32BE(400, 0)
  box.write('ftypmif1', 4, 'ascii')
  box.write('avif', 300, 'ascii')
  const path = ROOT + 'late.avif'
  const { definition } = tool({ [path]: { bytes: box } })
  expect(errorOf(await definition.run({ path }, CALLER))).toContain('not an AVIF image')
})

test('an unknown read error gives one fixed sentence, without its code', async () => {
  const definition = imageTool(
    { call: async () => STORED },
    async () => null,
    {
      stat: async () => {
        throw Object.assign(new Error('weird'), { code: 'EWEIRD_SECRET' })
      },
      read: async () => PNG,
    },
    async () => {},
  )
  const result = await definition.run({ path: ROOT + 'odd.png' }, CALLER)
  expect(errorOf(result)).toBe('The file could not be read.')
})
