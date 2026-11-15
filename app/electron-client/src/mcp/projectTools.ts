/** @file Definitions of the tools that read the open project. They run in the window; main forwards. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import { EDIT_TOOL_TIMEOUT_MS, WINDOW_TOOL_TIMEOUT_MS, type WindowBridge } from './windowBridge'

/** Most characters of a node id, a component name or a type name. */
const NAME_CHARS = 200
/** Most characters of a `search_components` query. */
const QUERY_CHARS = 500
/** Most characters of an expression to evaluate. */
const EXPRESSION_CHARS = 100_000

/** Most characters of one statement or expression an agent adds to a node. */
const STATEMENT_CHARS = 20_000

export const VIEW_TOOL_NAMES = [
  'get_graph',
  'get_node',
  'search_components',
  'get_component_docs',
  'evaluate_expression',
] as const

export const EDIT_TOOL_NAMES = [
  'add_nodes',
  'edit_node',
  'remove_nodes',
  'collapse_nodes',
  'add_function',
  'set_node_comment',
  'set_visualization',
  'select_nodes',
  'open_method',
] as const

export const PROJECT_TOOL_NAMES = [...VIEW_TOOL_NAMES, ...EDIT_TOOL_NAMES] as const

const nodeId = () => z.string().max(NAME_CHARS)

/** The refusal and undo rules every edit tool shares, appended to its description. */
const EDIT_RULES =
  ' Refused while the project is in Live mode. Your run of changes is one undo step for the ' +
  'user, until you pause for 10 seconds or the user edits; there is no undo tool. The project ' +
  'is saved as it is edited; nothing runs with output on (no Write), so no file, database or ' +
  'service the nodes name is written. `settled: true`: the engine has reported results for the ' +
  'changed nodes, so the types and errors in this result are current. `settled: false`: it had ' +
  'not within 20 seconds; call `get_node` later.'

/**
 * The project tools (the five that read, the nine that edit or navigate), each forwarding its
 * arguments to the window through `bridge`.
 */
export function projectTools(bridge: Pick<WindowBridge, 'call'>): ToolDefinition[] {
  const forward =
    (name: string, timeoutMs: number = WINDOW_TOOL_TIMEOUT_MS): ToolDefinition['run'] =>
    (args, caller) =>
      bridge.call(name, args, caller, timeoutMs)
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
        'returns fewer previews and cut texts, and `get_node` gives one node in full. ' +
        '`selection` lists the ids of the nodes the user has selected. Call this first to ' +
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
        'unavailable or evaluation fails. Runs only in the Design environment, where output is ' +
        'off: nothing is written to the file, database or service an expression names. A write ' +
        'that supports a dry run writes to a temporary file instead and returns that ' +
        "file's path; other writes fail. When the project is in Live mode the tool is refused.",
      inputSchema: {
        expression: z.string().max(EXPRESSION_CHARS),
        node_id: z.string().max(NAME_CHARS).optional(),
      },
      run: forward('evaluate_expression'),
    },
    {
      name: 'add_nodes',
      title: 'Add nodes',
      description:
        'Add nodes to the graph of the open project. Each of `statements` is one Enso ' +
        'statement: `name = expression` (the name becomes the node name) or a bare ' +
        'expression (a name is generated). Later statements may use the names of earlier ' +
        'ones and of existing nodes. `after_node` (an id from `get_graph`) places the new ' +
        'nodes after that node; without it they go at the end. `imports` are whole import ' +
        'lines (`from Standard.Table import Table`) added to the module if missing. Returns ' +
        'each new node with its id, name, expression and type and any error or panic, and ' +
        '`settled` (see below): check the types and errors, ' +
        'and fix a wrong node with `edit_node`. Add a few nodes at a time. The call is ' +
        'all-or-nothing: if any statement or import does not parse, a name is already ' +
        'taken, or `after_node` is unknown, nothing is added and the error says which.' +
        EDIT_RULES,
      inputSchema: {
        statements: z.array(z.string().min(1).max(STATEMENT_CHARS)).min(1).max(50),
        after_node: nodeId().optional(),
        imports: z.array(z.string().max(500)).max(20).optional(),
      },
      run: forward('add_nodes', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'edit_node',
      title: 'Edit a node',
      description:
        'Replace the expression of the node `node_id` (from `get_graph`) with `expression`. ' +
        '`expression` is the new right-hand side only, not `name = expression`: the node ' +
        'keeps its name, so the nodes that use it stay connected. An argument node of the ' +
        'method is refused. Returns `nodes`, a list holding the node with its new type and ' +
        'any error or panic, and `settled` (see below); call ' +
        '`get_graph` for the nodes that use it.' +
        EDIT_RULES,
      inputSchema: {
        node_id: nodeId(),
        expression: z.string().min(1).max(STATEMENT_CHARS),
      },
      run: forward('edit_node', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'remove_nodes',
      title: 'Remove nodes',
      description:
        'Remove the nodes in `node_ids` (from `get_graph`) from the graph. The nodes that used ' +
        'a removed node lose that input, as when the user deletes a node. The argument and ' +
        'output nodes of the method are refused, and then nothing is removed. Returns ' +
        '`removed`, the ids removed, and `settled`; call `get_graph` for the nodes that used ' +
        'them.' +
        EDIT_RULES,
      inputSchema: { node_ids: z.array(nodeId()).min(1).max(200) },
      run: forward('remove_nodes', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'collapse_nodes',
      title: 'Collapse nodes into a function',
      description:
        'Group the nodes in `node_ids` (from `get_graph`) into one new function, replaced ' +
        'in the graph by a single node that calls it. `name` names the function: a lowercase ' +
        'name such as `clean_names` (a name is generated without it; a number is added when ' +
        'the name is taken). Use it to keep a long graph readable. Refused when more than ' +
        'one of the nodes is used by nodes outside the group: the function returns one value. ' +
        'Returns `name`, the name the function got, `node`, the new node ' +
        'with its type and any error, and `settled`.' +
        EDIT_RULES,
      inputSchema: {
        node_ids: z.array(nodeId()).min(1).max(200),
        name: z.string().max(100).optional(),
      },
      run: forward('collapse_nodes', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'add_function',
      title: 'Add a function',
      description:
        '`source` is the source of one top-level function definition (a name, its ' +
        'arguments, `=`, and an indented body, for example `double x =\n    x * 2`), added ' +
        'to the module. A name already defined in the module is refused. Call it from a node ' +
        'as `Main.<name> args` (the form the IDE uses for the functions it generates), ' +
        "for example with `add_nodes`. Returns the function's `name` and `settled`; an error in " +
        'its definition shows on the nodes that call it.' +
        EDIT_RULES,
      inputSchema: { source: z.string().min(1).max(100_000) },
      run: forward('add_function', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'set_node_comment',
      title: 'Set a node comment',
      description:
        'Set the documentation comment of the node `node_id` (from `get_graph`) to `text`. ' +
        'An empty `text` removes the comment. A node that cannot have a comment (an argument ' +
        'of the method) is refused. Returns `node`, the node with its comment.' +
        EDIT_RULES,
      inputSchema: { node_id: nodeId(), text: z.string().max(5_000) },
      run: forward('set_node_comment', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'set_visualization',
      title: 'Show or hide a visualization',
      description:
        'Show (`visible` true) or hide the visualization of the node `node_id` (from ' +
        '`get_graph`) in the graph editor, for the user to look at. Returns `node`, the node.' +
        EDIT_RULES,
      inputSchema: { node_id: nodeId(), visible: z.boolean() },
      run: forward('set_visualization', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'select_nodes',
      title: 'Select nodes',
      description:
        'Select the nodes in `node_ids` (from `get_graph`) in the graph editor, to point ' +
        'the user at them; an empty list clears the selection. This and `open_method` are ' +
        'the only project tools that change the selection or move the view: the edit tools ' +
        'leave both alone. Returns `selected`, the ids of the selected nodes. Works in Live ' +
        'mode too.',
      inputSchema: { node_ids: z.array(nodeId()).max(200) },
      run: forward('select_nodes'),
    },
    {
      name: 'open_method',
      title: 'Open a method or go back',
      description:
        'Open the function that the node `node_id` (from `get_graph`) calls, in the graph ' +
        'editor, so the next `get_graph` reads its graph. Without `node_id` go back to the ' +
        'method you came from. Returns `method`, the name of the method now open. Works in ' +
        'Live mode too.',
      inputSchema: { node_id: nodeId().optional() },
      run: forward('open_method'),
    },
  ]
}
