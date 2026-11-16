/** @file Tests for the `get_visualization` tool's main half (`src/mcp/visualizationTool.ts`). */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { expect, test } from 'vitest'
import {
  IMAGE_MAX_SIDE,
  pngSize,
  visualizationTool,
  type CapturedImage,
  type CaptureRect,
} from '../../src/mcp/visualizationTool'

const CALLER: McpCaller = { kind: 'external', name: 'test' }

/** A PNG header for an image of that size: the signature, then IHDR. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

/** An image of `pixels` whose `getSize` is in units `factor` times coarser, as on a HiDPI screen. */
function image(width: number, height: number, factor = 1): CapturedImage {
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width: width / factor, height: height / factor }),
    resize: (options) => image(options.width * factor, options.height * factor, factor),
    toPNG: () => png(width, height),
  }
}

function tool(
  window: (tool: string, args: Record<string, unknown>) => McpToolResult,
  captured: CapturedImage | null = image(200, 150),
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const rects: CaptureRect[] = []
  const definition = visualizationTool(
    {
      call: async (name, args) => {
        calls.push({ tool: name, args })
        return window(name, args)
      },
    },
    async (rect) => {
      rects.push(rect)
      return captured
    },
  )
  return { definition, calls, rects }
}

const PREPARED: McpToolResult = {
  ok: true,
  value: JSON.stringify({
    node_id: 'n',
    visualization: 'Table',
    shown: false,
    moved: true,
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
  expect(rects).toEqual([{ x: 10, y: 20, width: 200, height: 150 }])
  expect(result).toEqual({
    ok: true,
    value: JSON.stringify(
      {
        node_id: 'n',
        visualization: 'Table',
        shown: false,
        moved: true,
        width: 200,
        height: 150,
      },
      null,
      1,
    ),
    image: { data: png(200, 150).toString('base64'), mimeType: 'image/png' },
  })
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
