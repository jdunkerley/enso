/**
 * @file The `get_visualization` tool: what a node's visualization shows, as a picture or as the
 * data the view was given. Unlike the other project tools its `run` does part of the work here in
 * main: the window gets the visualization ready and says where it is, and main captures that
 * rectangle of the window. It does not import `electron`: the caller supplies the capture.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolResult } from 'enso-common/src/mcp'
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import { EDIT_TOOL_TIMEOUT_MS, type WindowBridge } from './windowBridge'

export const VISUALIZATION_TOOL_NAME = 'get_visualization'
/** Most pixels of the image's longer side. */
export const IMAGE_MAX_SIDE = 1200
/** How long to wait between two captures of the same rectangle. */
export const CAPTURE_INTERVAL_MS = 150
/**
 * Most captures of one rectangle, the first included. The window can be composited a frame or more
 * behind the page (seen under software compositing), so a capture counts only once the next one
 * is the same; a view that never stops changing gives the last.
 */
export const CAPTURE_MAX_TRIES = 10
/** Most characters of a node id. */
const NAME_CHARS = 200

const NO_CAPTURE_ERROR =
  'The Enso window could not be captured (it may be minimised or hidden). Use format `data`.'

/** A rectangle in CSS pixels of the window's client area. */
export interface CaptureRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The part of Electron's `NativeImage` the tool uses. */
export interface CapturedImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; height: number; quality: 'best' }): CapturedImage
  toPNG(): Buffer
}

/** Captures that rectangle of the window; null when there is no window to capture. */
export type Capture = (rect: CaptureRect) => Promise<CapturedImage | null>

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The pixel size a PNG declares in its IHDR chunk; undefined when the bytes are not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined
  if (png.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const preparedSchema = z.object({
  node_id: z.string(),
  visualization: z.string(),
  shown: z.boolean(),
  moved: z.boolean(),
  rect: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
})

/**
 * The PNG of the capture, at most {@link IMAGE_MAX_SIDE} pixels on its longer side. The size is
 * read from the PNG: `getSize` is in logical units, which are not pixels on a HiDPI screen.
 */
function cappedPng(image: CapturedImage): { png: Buffer; width: number; height: number } | null {
  let png = image.toPNG()
  let size = pngSize(png)
  if (size == null) return null
  const longest = Math.max(size.width, size.height)
  if (longest > IMAGE_MAX_SIDE) {
    const logical = image.getSize()
    const ratio = IMAGE_MAX_SIDE / longest
    png = image
      .resize({
        width: Math.max(1, Math.floor(logical.width * ratio)),
        height: Math.max(1, Math.floor(logical.height * ratio)),
        quality: 'best',
      })
      .toPNG()
    size = pngSize(png)
    if (size == null) return null
  }
  return { png, ...size }
}

/**
 * Captures the rectangle until two captures in a row have the same PNG bytes, at most
 * {@link CAPTURE_MAX_TRIES} times, {@link CAPTURE_INTERVAL_MS} apart. Null when a capture is
 * missing or empty.
 */
async function stableCapture(
  capture: Capture,
  rect: CaptureRect,
  sleep: (ms: number) => Promise<void>,
): Promise<CapturedImage | null> {
  let image = await capture(rect)
  if (image == null || image.isEmpty()) return null
  let png = image.toPNG()
  for (let tries = 1; tries < CAPTURE_MAX_TRIES; tries++) {
    await sleep(CAPTURE_INTERVAL_MS)
    const next = await capture(rect)
    if (next == null || next.isEmpty()) return null
    const nextPng = next.toPNG()
    image = next
    if (nextPng.equals(png)) break
    png = nextPng
  }
  return image
}

/**
 * The `get_visualization` tool over the window (`bridge`) and a way to photograph it. `sleep` is
 * the wait between captures (instant in tests).
 */
export function visualizationTool(
  bridge: Pick<WindowBridge, 'call'>,
  capture: Capture,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): ToolDefinition {
  return {
    name: VISUALIZATION_TOOL_NAME,
    title: 'Look at a visualization',
    description:
      'Look at the visualization of the node `node_id` (from `get_graph`): the table, chart ' +
      'or other view the user sees under the node. `format` is `image` (the default): a PNG ' +
      'of the visualization as drawn, with `{ node_id, visualization, shown, moved, width, ' +
      'height }`; or `data`: `{ node_id, visualization, shown, truncated, data }`, the data ' +
      'the view was given (its shape belongs to the view and may change; at most 20,000 ' +
      'characters, then `truncated` is true and `data` is the start of the text). A table ' +
      'shows its first 1,000 rows by default, either way. A hidden visualization is shown ' +
      'first (`shown` true), as `set_visualization` does: that is refused in Live mode and ' +
      'is part of your undo step; hide it again with `set_visualization` if the user did ' +
      'not ask to see it. For `image` the graph view moves when the visualization is not ' +
      'wholly on screen at 100% zoom (`moved` true), and the Enso window must not be ' +
      'minimised. An error when the visualization is still loading after 15 seconds or ' +
      'failed to load. To read values, prefer `get_node` or `evaluate_expression`; use ' +
      'this to see what the user sees, such as a chart.',
    inputSchema: {
      node_id: z.string().max(NAME_CHARS),
      format: z.enum(['image', 'data']).optional(),
    },
    run: async (args, caller): Promise<McpToolResult> => {
      const node = { node_id: args.node_id }
      if (args.format === 'data') {
        return bridge.call('get_visualization_data', node, caller, EDIT_TOOL_TIMEOUT_MS)
      }
      const prepared = await bridge.call(
        'prepare_visualization',
        node,
        caller,
        EDIT_TOOL_TIMEOUT_MS,
      )
      if (!prepared.ok) return prepared
      let parsed
      try {
        parsed = preparedSchema.safeParse(JSON.parse(prepared.value))
      } catch {
        parsed = undefined
      }
      if (parsed == null || !parsed.success) {
        return {
          ok: false,
          error: 'The Enso window did not say where the visualization is.',
        }
      }
      const { rect, ...about } = parsed.data
      const image = await stableCapture(capture, rect, sleep)
      if (image == null) return { ok: false, error: NO_CAPTURE_ERROR }
      const capped = cappedPng(image)
      if (capped == null) return { ok: false, error: NO_CAPTURE_ERROR }
      return {
        ok: true,
        value: JSON.stringify({ ...about, width: capped.width, height: capped.height }, null, 1),
        image: { data: capped.png.toString('base64'), mimeType: 'image/png' },
      }
    },
  }
}
