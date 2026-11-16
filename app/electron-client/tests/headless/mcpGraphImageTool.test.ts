/** @file Tests for the `get_graph_image` tool's main half (`src/mcp/graphImageTool.ts`). */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { expect, test } from 'vitest'
import {
  GRAPH_IMAGE_NODES_MAX,
  GRAPH_IMAGE_TOOL_NAME,
  graphImageTool,
} from '../../src/mcp/graphImageTool'
import { ToolRegistry } from '../../src/mcp/toolRegistry'
import {
  CAPTURE_INTERVAL_MS,
  IMAGE_MAX_SIDE,
  type CapturedImage,
  type CaptureRect,
} from '../../src/mcp/visualizationTool'
import { WINDOW_TOOL_TIMEOUT_MS } from '../../src/mcp/windowBridge'

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

function image(width: number, height: number, tag = 0): CapturedImage {
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width, height }),
    resize: (options) => image(options.width, options.height, tag),
    toPNG: () => png(width, height, tag),
  }
}

function tool(
  window: (tool: string, args: Record<string, unknown>) => McpToolResult,
  captured: CapturedImage | null | (CapturedImage | null)[] = image(1000, 800),
) {
  const calls: { tool: string; args: Record<string, unknown>; timeoutMs: number | undefined }[] = []
  const rects: CaptureRect[] = []
  const sleeps: number[] = []
  const frames = Array.isArray(captured) ? captured : [captured]
  const definition = graphImageTool(
    {
      call: async (name, args, _caller, timeoutMs) => {
        calls.push({ tool: name, args, timeoutMs })
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

const RECT = { x: 10, y: 20, width: 1000, height: 800 }
const PREPARED: McpToolResult = {
  ok: true,
  value: JSON.stringify({ rect: RECT, scale: 0.5, nodes: 7 }),
}

test('the window frames the nodes, then main captures the viewport it answered', async () => {
  const { definition, calls, rects } = tool(() => PREPARED)
  expect(definition.name).toBe(GRAPH_IMAGE_TOOL_NAME)
  const result = await definition.run({ node_ids: ['a', 'b'] }, CALLER)
  expect(calls).toEqual([
    {
      tool: 'prepare_graph_image',
      args: { node_ids: ['a', 'b'] },
      timeoutMs: WINDOW_TOOL_TIMEOUT_MS,
    },
  ])
  // An unchanging frame is captured twice: the second confirms the first.
  expect(rects).toEqual([RECT, RECT])
  expect(result).toEqual({
    ok: true,
    value: JSON.stringify({ scale: 0.5, width: 1000, height: 800, nodes: 7 }, null, 1),
    image: { data: png(1000, 800).toString('base64'), mimeType: 'image/png' },
  })
})

test('without node_ids nothing is passed to the window', async () => {
  const { definition, calls } = tool(() => PREPARED)
  await definition.run({}, CALLER)
  expect(calls[0]!.args).toEqual({})
})

test('the capture is repeated until stable, and capped at the longest side', async () => {
  const { definition, rects, sleeps } = tool(
    () => PREPARED,
    [image(2400, 1600, 1), image(2400, 1600, 2), image(2400, 1600, 2)],
  )
  const result = await definition.run({}, CALLER)
  expect(rects).toHaveLength(3)
  expect(sleeps).toEqual([CAPTURE_INTERVAL_MS, CAPTURE_INTERVAL_MS])
  assert(result.ok)
  expect(JSON.parse(result.value)).toEqual({
    scale: 0.5,
    width: IMAGE_MAX_SIDE,
    height: 800,
    nodes: 7,
  })
})

test("the window's refusal is the result, and nothing is captured", async () => {
  const refusal: McpToolResult = { ok: false, error: 'The method on screen has no nodes.' }
  const { definition, rects } = tool(() => refusal)
  expect(await definition.run({}, CALLER)).toEqual(refusal)
  expect(rects).toEqual([])
})

test('a reply without a rectangle is an error, and nothing is captured', async () => {
  const { definition, rects } = tool(() => ({ ok: true, value: '{"scale":1}' }))
  const result = await definition.run({}, CALLER)
  expect(result.ok).toBe(false)
  expect(rects).toEqual([])
})

test('no capture is an error', async () => {
  const { definition } = tool(() => PREPARED, null)
  const result = await definition.run({}, CALLER)
  expect(result.ok).toBe(false)
  assert(!result.ok)
  expect(result.error).toContain('could not be captured')
})

test('node_ids takes 1 to 500 ids', async () => {
  expect(GRAPH_IMAGE_NODES_MAX).toBe(500)
  const registry = new ToolRegistry()
  registry.register(tool(() => PREPARED).definition)
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`)
  expect((await registry.call(GRAPH_IMAGE_TOOL_NAME, { node_ids: ids(500) }, CALLER)).ok).toBe(true)
  expect((await registry.call(GRAPH_IMAGE_TOOL_NAME, { node_ids: ids(501) }, CALLER)).ok).toBe(
    false,
  )
  expect((await registry.call(GRAPH_IMAGE_TOOL_NAME, { node_ids: [] }, CALLER)).ok).toBe(false)
  expect((await registry.call(GRAPH_IMAGE_TOOL_NAME, {}, CALLER)).ok).toBe(true)
})

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error('assertion failed')
}
