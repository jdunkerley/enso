/** @file Tests for the `get_visualization` tool's main half (`src/mcp/visualizationTool.ts`). */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { expect, test } from 'vitest'
import {
  CAPTURE_INTERVAL_MS,
  CAPTURE_MAX_TRIES,
  IMAGE_MAX_SIDE,
  pngSize,
  visualizationTool,
  type CapturedImage,
  type CaptureRect,
} from '../../src/mcp/visualizationTool'

const CALLER: McpCaller = { kind: 'external', name: 'test' }

/** A PNG header for an image of that size: the signature, then IHDR; then `tag`, to tell frames apart. */
function png(width: number, height: number, tag = 0): Buffer {
  const buffer = Buffer.alloc(25)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  buffer.writeUInt8(tag, 24)
  return buffer
}

/** An image of `pixels` whose `getSize` is in units `factor` times coarser, as on a HiDPI screen. */
function image(width: number, height: number, factor = 1, tag = 0): CapturedImage {
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width: width / factor, height: height / factor }),
    resize: (options) => image(options.width * factor, options.height * factor, factor, tag),
    toPNG: () => png(width, height, tag),
  }
}

function tool(
  window: (tool: string, args: Record<string, unknown>) => McpToolResult,
  captured: CapturedImage | null | (CapturedImage | null)[] = image(200, 150),
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const rects: CaptureRect[] = []
  const sleeps: number[] = []
  // A list is the frames in turn; its last one repeats.
  const frames = Array.isArray(captured) ? captured : [captured]
  const definition = visualizationTool(
    {
      call: async (name, args) => {
        calls.push({ tool: name, args })
        return window(name, args)
      },
    },
    async (rect) => {
      rects.push(rect)
      return frames[Math.min(rects.length, frames.length) - 1]!
    },
    async (ms) => {
      sleeps.push(ms)
    },
  )
  return { definition, calls, rects, sleeps }
}

const PREPARED: McpToolResult = {
  ok: true,
  value: JSON.stringify({
    node_id: 'n',
    visualization: 'Table',
    shown: false,
    changed: true,
    moved: true,
    available: ['Table', 'JSON'],
    rect: { x: 10, y: 20, width: 200, height: 150 },
  }),
}

test('pngSize reads the IHDR size, and nothing from other bytes', () => {
  expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 })
  expect(pngSize(Buffer.from('not a png'))).toBeUndefined()
})

test('data is forwarded to the window', async () => {
  const data: McpToolResult = { ok: true, value: '{"data":1}' }
  const { definition, calls, rects } = tool(() => data)
  expect(await definition.run({ node_id: 'n', format: 'data' }, CALLER)).toEqual(data)
  expect(calls).toEqual([{ tool: 'get_visualization_data', args: { node_id: 'n' } }])
  expect(rects).toEqual([])
})

test('image is the default: the prepared rectangle is captured', async () => {
  const { definition, calls, rects } = tool(() => PREPARED)
  const result = await definition.run({ node_id: 'n' }, CALLER)
  expect(calls).toEqual([{ tool: 'prepare_visualization', args: { node_id: 'n' } }])
  // A frame that does not change is captured twice: the second capture confirms the first.
  const rect = { x: 10, y: 20, width: 200, height: 150 }
  expect(rects).toEqual([rect, rect])
  expect(result).toEqual({
    ok: true,
    value: JSON.stringify(
      {
        node_id: 'n',
        visualization: 'Table',
        shown: false,
        changed: true,
        moved: true,
        available: ['Table', 'JSON'],
        width: 200,
        height: 150,
      },
      null,
      1,
    ),
    image: { data: png(200, 150).toString('base64'), mimeType: 'image/png' },
  })
})

test('a named visualization is forwarded to both window handlers', async () => {
  const data: McpToolResult = { ok: true, value: '{"data":1}' }
  const { definition, calls } = tool((name) =>
    name === 'get_visualization_data' ? data : PREPARED,
  )
  await definition.run({ node_id: 'n', format: 'data', visualization: 'JSON' }, CALLER)
  await definition.run({ node_id: 'n', visualization: 'JSON' }, CALLER)
  expect(calls).toEqual([
    { tool: 'get_visualization_data', args: { node_id: 'n', visualization: 'JSON' } },
    { tool: 'prepare_visualization', args: { node_id: 'n', visualization: 'JSON' } },
  ])
})

test('a visualization name is at most 100 characters', () => {
  const { definition } = tool(() => PREPARED)
  const schema = definition.inputSchema.visualization!
  expect(schema.safeParse('x'.repeat(100)).success).toBe(true)
  expect(schema.safeParse('x'.repeat(101)).success).toBe(false)
})

test("the window's refusal is the result, and nothing is captured", async () => {
  const refusal: McpToolResult = { ok: false, error: 'No node n' }
  const { definition, rects } = tool(() => refusal)
  expect(await definition.run({ node_id: 'n' }, CALLER)).toEqual(refusal)
  expect(rects).toEqual([])
})

test('a large capture is scaled down to the cap', async () => {
  const { definition } = tool(() => PREPARED, image(2400, 1200))
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  expect(pngSize(Buffer.from(result.image!.data, 'base64'))).toEqual({
    width: IMAGE_MAX_SIDE,
    height: 600,
  })
})

test('a HiDPI capture is capped by its pixels, not its logical size', async () => {
  // 1000 x 500 logical at 2x is 2000 x 1000 pixels.
  const { definition } = tool(() => PREPARED, image(2000, 1000, 2))
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  expect(pngSize(Buffer.from(result.image!.data, 'base64'))).toEqual({
    width: IMAGE_MAX_SIDE,
    height: 600,
  })
})

test('no capture is an error that names the other format', async () => {
  for (const captured of [null, image(0, 0)]) {
    const { definition } = tool(() => PREPARED, captured)
    const result = await definition.run({ node_id: 'n' }, CALLER)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('format `data`')
  }
})

test('a reply without a rectangle is an error', async () => {
  const { definition, rects } = tool(() => ({
    ok: true,
    value: '{"rect":{"x":"a"}}',
  }))
  expect((await definition.run({ node_id: 'n' }, CALLER)).ok).toBe(false)
  expect(rects).toEqual([])
})

test('the capture is repeated until a frame equals the one before, and that frame is the image', async () => {
  const a = image(200, 150, 1, 1)
  const b = image(200, 150, 1, 2)
  const { definition, rects, sleeps } = tool(() => PREPARED, [a, b, b])
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  expect(rects).toHaveLength(3)
  expect(sleeps).toEqual([CAPTURE_INTERVAL_MS, CAPTURE_INTERVAL_MS])
  expect(result.image!.data).toBe(png(200, 150, 2).toString('base64'))
})

test('a capture that never settles stops at the most tries and gives the last frame', async () => {
  const frames = Array.from({ length: CAPTURE_MAX_TRIES + 5 }, (_, i) => image(200, 150, 1, i))
  const { definition, rects } = tool(() => PREPARED, frames)
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  expect(rects).toHaveLength(CAPTURE_MAX_TRIES)
  expect(result.image!.data).toBe(png(200, 150, CAPTURE_MAX_TRIES - 1).toString('base64'))
})

test('a capture lost after the first is an error that names the other format', async () => {
  const { definition, rects } = tool(() => PREPARED, [image(200, 150, 1, 1), null])
  const result = await definition.run({ node_id: 'n' }, CALLER)
  expect(rects).toHaveLength(2)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain('format `data`')
})

test('only the final capture is scaled to the cap', async () => {
  const big = image(2400, 1200, 1, 1)
  const { definition } = tool(() => PREPARED, [image(2400, 1200, 1, 0), big, big])
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  const bytes = Buffer.from(result.image!.data, 'base64')
  expect(pngSize(bytes)).toEqual({ width: IMAGE_MAX_SIDE, height: 600 })
  expect(bytes[24]).toBe(1)
})

test('the project id the window answered with is not passed on to the agent', async () => {
  const prepared = JSON.parse((PREPARED as { value: string }).value)
  const { definition } = tool(() => ({
    ok: true,
    value: JSON.stringify({ ...prepared, project_id: 'p1' }),
  }))
  const result = await definition.run({ node_id: 'n' }, CALLER)
  if (!result.ok) throw new Error(result.error)
  expect(JSON.parse(result.value)).not.toHaveProperty('project_id')
})
