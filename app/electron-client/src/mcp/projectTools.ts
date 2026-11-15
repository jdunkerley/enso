/** @file Definitions of the tools that read the open project. They run in the window; main forwards. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import type { WindowBridge } from './windowBridge'

export const PROJECT_TOOL_NAMES = [
  'get_graph',
  'get_node',
  'search_components',
  'get_component_docs',
  'evaluate_expression',
] as const

/** The five project tools, each forwarding its arguments to the window through `bridge`. */
export function projectTools(bridge: Pick<WindowBridge, 'call'>): ToolDefinition[] {
  const forward =
    (name: string): ToolDefinition['run'] =>
    (args, caller) =>
      bridge.call(name, args, caller)
  return [
    {
      name: 'get_graph',
      title: 'Get the open graph',
      description:
        'Read the graph of the open project: its nodes (with their ids, expressions, ' +
        'types and, unless `previews` is false, a short preview of their current value), ' +
        'the connections between them, and any problems. Call this first to see what the ' +
        'project does. Each `node_id` is stable across edits, so you can pass it to ' +
        '`get_node` and `evaluate_expression` later.',
      inputSchema: { previews: z.boolean().optional() },
      run: forward('get_graph'),
    },
    {
      name: 'get_node',
      title: 'Get one node',
      description:
        'Read one node of the open graph by `node_id` (from `get_graph`): its name, full ' +
        'expression, kind, type, documentation comment and evaluation state (with the ' +
        'message of a panic and the number of warnings), a longer preview of its current ' +
        'value, and the text of its error when it evaluated to one. Use it when ' +
        '`get_graph` is too brief.',
      inputSchema: { node_id: z.string() },
      run: forward('get_node'),
    },
    {
      name: 'search_components',
      title: 'Search components',
      description:
        'Search the component browser for functions, methods and types matching `query`. ' +
        'Pass `self_type` (a qualified type name) to list only methods callable on a value ' +
        'of that type. Returns up to `limit` (1-50) matches, each with its qualified name ' +
        'and a one-line summary. Pass a qualified name to `get_component_docs` for details.',
      inputSchema: {
        query: z.string(),
        self_type: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      run: forward('search_components'),
    },
    {
      name: 'get_component_docs',
      title: 'Get component documentation',
      description:
        'Read the documentation of one component: its signature, arguments with defaults, ' +
        'and description. `name` is a qualified name returned by `search_components`.',
      inputSchema: { name: z.string() },
      run: forward('get_component_docs'),
    },
    {
      name: 'evaluate_expression',
      title: 'Evaluate an Enso expression',
      description:
        'Evaluate a plain Enso expression in the open project, optionally in the scope of ' +
        'the node `node_id` so its bindings are referenceable by name. Use sparingly to ' +
        'learn things you cannot infer from types alone (column names, value previews, ' +
        'join shapes). Each call costs a real language server round-trip (hundreds of ' +
        'milliseconds to a few seconds). The expression must evaluate to Text - pick the ' +
        'encoding yourself with `.to_text`, `.to_display_text`, or `.to_json`. For ' +
        'expressions that may produce a DataflowError wrap with ' +
        '`.catch_primitive (e -> e.to_display_text)` so the result is still Text. ' +
        'Returns the text the expression produced, or an error string if the scope is ' +
        'unavailable or evaluation fails. Runs in the Design environment: it cannot write files.',
      inputSchema: { expression: z.string(), node_id: z.string().optional() },
      run: forward('evaluate_expression'),
    },
  ]
}
