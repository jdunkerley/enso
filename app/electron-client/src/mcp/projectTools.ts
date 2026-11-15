/** @file Definitions of the tools that read the open project. They run in the window; main forwards. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import type { WindowBridge } from './windowBridge'

/** Most characters of a node id, a component name or a type name. */
const NAME_CHARS = 200
/** Most characters of a `search_components` query. */
const QUERY_CHARS = 500
/** Most characters of an expression to evaluate. */
const EXPRESSION_CHARS = 100_000

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
        'Read the graph of the open project: the method source, the module imports, and ' +
        'its nodes (with their ids, names, expressions, types, evaluation state, any panic ' +
        'message and, unless `previews` is false, a short preview of their current value). ' +
        'There is no separate edge list: a node uses another by its name, so read the ' +
        'connections from each node `code` and from `source`. When previews run out of ' +
        'time or space, `previews_skipped` counts the nodes left without one: a long graph ' +
        'returns fewer previews and cut texts, and `get_node` gives one node in full. Call this first to ' +
        'see what the project does. Each `node_id` is stable across edits, so you can pass ' +
        'it to `get_node` and `evaluate_expression` later.',
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
      inputSchema: { node_id: z.string().max(NAME_CHARS) },
      run: forward('get_node'),
    },
    {
      name: 'search_components',
      title: 'Search components',
      description:
        'Search the component browser for methods matching `query`, best match first. ' +
        'Without `self_type` it finds the functions called on a module or type ' +
        '(`Data.read`, `Table.new`); pass `self_type` (a qualified type name, as `get_graph` ' +
        'prints a node type) to find the methods callable on a value of that type instead. ' +
        'Returns up to `limit` (1-50, default 20) `results`, each with its qualified `name`, ' +
        'its `signature` and a one-line `summary`, and `total`, the number of matches. Pass a ' +
        '`name` to `get_component_docs` for details.',
      inputSchema: {
        query: z.string().max(QUERY_CHARS),
        self_type: z.string().max(NAME_CHARS).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      run: forward('search_components'),
    },
    {
      name: 'get_component_docs',
      title: 'Get component documentation',
      description:
        'Read the documentation of one component: its signature, its arguments (type, ' +
        'default, whether optional, and the values offered for it), its return type and its ' +
        'description. `name` is a qualified name returned by `search_components`.',
      inputSchema: { name: z.string().max(NAME_CHARS) },
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
      inputSchema: {
        expression: z.string().max(EXPRESSION_CHARS),
        node_id: z.string().max(NAME_CHARS).optional(),
      },
      run: forward('evaluate_expression'),
    },
  ]
}
