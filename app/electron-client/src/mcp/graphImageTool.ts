/**
 * @file The `get_graph_image` tool: a picture of the nodes as the graph editor draws them.
 * Like `get_visualization` its `run` does part of the work here in main: the window handler
 * `prepare_graph_image` (not an MCP tool) frames the nodes and says where they are on screen, and
 * main captures that rectangle, as `get_visualization` captures a visualization. Nothing is passed
 * to the window after the capture, so no project check is needed. It does not import `electron`:
 * the caller supplies the capture.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import { cappedPng, sleepFor, stableCapture, type Capture } from './visualizationTool'
import { WINDOW_TOOL_TIMEOUT_MS, type WindowBridge } from './windowBridge'

export const GRAPH_IMAGE_TOOL_NAME = 'get_graph_image'
/** Most `node_ids` one call frames. */
export const GRAPH_IMAGE_NODES_MAX = 500
/** Most characters of a node id. */
const NAME_CHARS = 200

const NO_CAPTURE_ERROR =
  'The Enso window could not be captured (it may be minimised or hidden). Ask the user to ' +
  'bring it back, then try again.'

const preparedSchema = z.object({
  rect: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  scale: z.number().positive(),
  nodes: z.number().int().nonnegative(),
})

/**
 * The `get_graph_image` tool over the window (`bridge`) and a way to photograph it. `sleep` is the
 * wait between captures (instant in tests).
 */
export function graphImageTool(
  bridge: Pick<WindowBridge, 'call'>,
  capture: Capture,
  sleep: (ms: number) => Promise<void> = sleepFor,
): ToolDefinition {
  return {
    name: GRAPH_IMAGE_TOOL_NAME,
    title: 'Take a picture of the graph',
    description:
      'Take a picture of the graph editor, to see the layout as the user sees it. The view is ' +
      'moved and zoomed, without animation, to frame all the nodes of the method on screen, or ' +
      'only those of `node_ids` (ids from `get_graph`, 1 to 500; an unknown id refuses), ' +
      'at a zoom between 10% and 100% (never larger), clear of the top bar of the editor. Below 10% ' +
      'not every node fits: the picture then shows the middle of them. It moves the view and ' +
      'does not move it back. Returns a PNG of the framed nodes with a small margin, as drawn ' +
      'on screen (at most 1,200 pixels on its longer side), with ' +
      '`{ scale, width, height, nodes }`: `scale`, the zoom (1 is 100%); `width` and `height`, ' +
      'the picture in pixels; `nodes`, how many nodes were framed (a node not drawn yet is ' +
      'left out). At a low `scale` the text ' +
      'is not legible: frame fewer nodes with `node_ids` to read them. A method with no nodes ' +
      'is an error. It edits nothing and works in Live mode too; the Enso window must not be ' +
      'minimised.',
    inputSchema: {
      node_ids: z.array(z.string().max(NAME_CHARS)).min(1).max(GRAPH_IMAGE_NODES_MAX).optional(),
    },
    run: async (args, caller: McpCaller): Promise<McpToolResult> => {
      const prepared = await bridge.call(
        'prepare_graph_image',
        args.node_ids != null ? { node_ids: args.node_ids } : {},
        caller,
        WINDOW_TOOL_TIMEOUT_MS,
      )
      if (!prepared.ok) return prepared
      let parsed
      try {
        parsed = preparedSchema.safeParse(JSON.parse(prepared.value))
      } catch {
        parsed = undefined
      }
      if (parsed == null || !parsed.success) {
        return { ok: false, error: 'The Enso window did not say where the graph is.' }
      }
      const { rect, scale, nodes } = parsed.data
      const image = await stableCapture(capture, rect, sleep)
      const capped = image != null ? cappedPng(image) : null
      if (capped == null) return { ok: false, error: NO_CAPTURE_ERROR }
      const { png, width, height } = capped
      return {
        ok: true,
        value: JSON.stringify({ scale, width, height, nodes }, null, 1),
        image: { data: png.toString('base64'), mimeType: 'image/png' },
      }
    },
  }
}
