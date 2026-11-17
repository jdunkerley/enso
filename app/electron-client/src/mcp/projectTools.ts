/**
 * @file Definitions of the project tools: those that read the open project and those that edit or
 * navigate it. They run in the window; main forwards.
 */
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

/** Most characters of the documentation `set_documentation` writes. */
const DOCUMENTATION_CHARS = 100_000

/** Most characters of one statement or expression an agent adds to a node. */
const STATEMENT_CHARS = 20_000

/** Most characters of the comment `save_version` writes. */
const VERSION_COMMENT_CHARS = 500

/** Most nodes one `move_nodes` call moves. */
const MOVE_NODES_MAX = 200
/** The farthest from the origin, in scene units, a node may be moved to on either axis. */
const COORDINATE_LIMIT = 1_000_000
/** Most nodes one `arrange_nodes` call lays out. */
const ARRANGE_NODES_MAX = 500
/** The smallest and largest width or height, in scene units, `set_visualization` sets. */
const VISUALIZATION_SIZE_MIN = 100
const VISUALIZATION_SIZE_MAX = 2_000

export const VIEW_TOOL_NAMES = [
  'get_graph',
  'get_node',
  'search_components',
  'get_component_docs',
  'evaluate_expression',
  'list_visualizations',
  'get_documentation',
  'get_problems',
] as const

export const EDIT_TOOL_NAMES = [
  'add_nodes',
  'edit_node',
  'remove_nodes',
  'collapse_nodes',
  'add_function',
  'set_node_comment',
  'set_documentation',
  'set_visualization',
  'move_nodes',
  'arrange_nodes',
  'undo',
  'redo',
  'save_version',
  'refresh',
  'select_nodes',
  'open_method',
] as const

export const PROJECT_TOOL_NAMES = [...VIEW_TOOL_NAMES, ...EDIT_TOOL_NAMES] as const

const nodeId = () => z.string().max(NAME_CHARS)
/** A visualization's width or height: in scene units, `null` for the default, or left out. */
const visualizationSize = () =>
  z.number().finite().min(VISUALIZATION_SIZE_MIN).max(VISUALIZATION_SIZE_MAX).nullable().optional()

/**
 * The Write rule, in the tool descriptions that take code. It says what the Write guard
 * (`app/gui/src/project-view/mcp/writeGuard.ts`) refuses and the two ways an edit can still cause
 * a write, which the guard does not stop.
 */
const WRITE_RULE =
  'Do not turn Write on. Code that enables the output context (`with_enabled_context`, ' +
  '`with_enabled`, binding a runtime builtin, building a method name by reflection, looking a ' +
  'method up by a name in text, or evaluating text as code) is refused. Only the user turns Write on, by clicking it on a node. Your edits can still cause ' +
  "a write in two ways you should avoid: calling a function in the user's project that itself " +
  'enables output, and changing a node upstream of one the user has switched Write on for (it ' +
  're-runs with your change). Ask the user before doing either.'

/** The refusal and undo rules every edit tool shares, appended to its description. */
const EDIT_RULES =
  ' Refused while the project is in Live mode, and, with nothing changed, when the method on ' +
  'screen changed before the edit ran (call `get_graph` and try again). Your run of changes is ' +
  'one undo step for the user, until you pause for 10 seconds, the user edits or leaves the ' +
  "project's tab, or `open_method` changes the method; `undo` takes it back. The project is " +
  'saved as it is edited. ' +
  WRITE_RULE +
  ' `settled: true`: the engine has reported results for the changed nodes, so the types ' +
  'and errors in this result are current. `settled: false`: it had not within 20 seconds; call ' +
  '`get_node` later.'

/**
 * The project tools (the seven that read, the fifteen that edit or navigate), each forwarding its
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
        '`selection` lists the ids of the nodes the user has selected. With `layout` true, ' +
        'each node also has `position` `{ x, y }` (its top-left as stored) and `area` ' +
        '`{ x, y, width, height }` (the room it takes on screen with its visualization; absent ' +
        'for a node not drawn yet), and the result has `view` `{ x, y, width, height, scale }`, ' +
        'the part of the graph on screen and the zoom it is drawn at (`scale`, 1 is 100%); ' +
        'the rest in scene units (pixels at 100% zoom, x to the right, y down), rounded. ' +
        'Call this first to ' +
        'see what the project does. Each `node_id` is stable across edits, so you can pass ' +
        'it to `get_node` and `evaluate_expression` later.',
      inputSchema: { previews: z.boolean().optional(), layout: z.boolean().optional() },
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
        'off: a write does not reach the file, database or service the expression names. A ' +
        'write that supports a dry run writes to a temporary file instead and returns that ' +
        "file's path; other writes fail. When the project is in Live mode the tool is " +
        'refused. ' +
        WRITE_RULE,
      inputSchema: {
        expression: z.string().max(EXPRESSION_CHARS),
        node_id: z.string().max(NAME_CHARS).optional(),
      },
      run: forward('evaluate_expression'),
    },
    {
      name: 'list_visualizations',
      title: 'List the visualizations of a node',
      description:
        'List the visualizations the node `node_id` (from `get_graph`) offers for its type, ' +
        'in the order of the dropdown in its visualization toolbar. Returns `{ node_id, ' +
        'shown, visualization, available }`: `shown`, whether its visualization is switched ' +
        'on; `visualization`, the name of the one on screen (null when none is); `available`, ' +
        'the names to pass to `get_visualization` as `visualization`; `size`, `{ width, height, ' +
        'default_width, default_height }`: its size as drawn in scene units (as it would be ' +
        'when hidden) and whether each is the default. Shows, moves and changes nothing, and ' +
        'works in Live mode too.',
      inputSchema: { node_id: nodeId() },
      run: forward('list_visualizations'),
    },
    {
      name: 'get_documentation',
      title: 'Read the documentation',
      description:
        'Read the documentation of the function on screen: the Markdown the documentation ' +
        "panel shows, the workflow's at the top level and a function's of the project after " +
        '`open_method`. Returns `{ method, text, truncated }`: `method`, the name of the ' +
        'function; `text`, its Markdown, at most 50,000 characters (the start of it, with ' +
        '`truncated: true`, when longer). Changes nothing, and works in Live mode too.',
      inputSchema: {},
      run: forward('get_documentation'),
    },
    {
      name: 'get_problems',
      title: 'List the errors and warnings',
      description:
        'List every error and warning of the function on screen in one call, without the ' +
        'values `get_graph` also returns. Returns `{ method, nodes, diagnostics, errors, ' +
        'warnings, pending, truncated }`. Each of `nodes` (in the order of `get_graph`, at most ' +
        '100: errors and panics are kept before warnings, and `truncated` says some were ' +
        'left out) has `id`, `name`, `state` (`panic`, `error` or `warning`) and `message`. ' +
        'For an error or a panic `origin` is false when a node this one takes input from has ' +
        'the same message, true otherwise: fix the `origin: true` nodes first, the rest ' +
        'usually clear by themselves. A warning node has `warnings`, how many there are; its ' +
        '`message` is the text of the first (null when the engine did not send it), and the ' +
        'rest are in its `Warnings` visualization (`get_visualization` with that name). The ' +
        'text of an error loads on first look and is waited for at most 5 seconds: a node ' +
        'whose text did not arrive has `message: null`, and `messages_pending` counts them; ' +
        'call again. `diagnostics` (at most 50) are the compile errors and warnings of the module ' +
        'that lie in this function or have no position, each with `kind`, `message` and, when ' +
        'known, the `line` of the module (`diagnostics_truncated` when there were more). `pending` is how many nodes are still computing: ' +
        'when it is not 0, call again. Changes and runs nothing, and works in Live mode too.',
      inputSchema: {},
      run: forward('get_problems'),
    },
    {
      name: 'add_nodes',
      title: 'Add nodes',
      description:
        'Add nodes to the graph of the open project. Each of `statements` is one Enso ' +
        'statement: `name = expression` (the name becomes the node name) or a bare ' +
        'expression (a name is generated). Later statements may use the names of earlier ' +
        'ones and of existing nodes. In the code the new nodes are always added at the end of ' +
        'the method; `after_node` (an id from `get_graph`) only sets where they are drawn, below ' +
        'that node (without it, below the last node). `imports` are whole import ' +
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
        'method is refused, and so is a node the user turned Write on for. Returns `nodes`, a ' +
        'list holding the node with its new type and ' +
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
        'a removed node lose that input, as when the user deletes a node. Removing a node ' +
        'rewrites the nodes that used it, and if the user switched Write on for one of those, it ' +
        're-runs with output: ask the user first. The argument and ' +
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
        'A node the user turned Write on for is refused, and then nothing is collapsed. ' +
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
        'of the method) is refused. Returns `node`, the node with its comment, and `settled` ' +
        '(always true: nothing is computed again).' +
        EDIT_RULES,
      inputSchema: { node_id: nodeId(), text: z.string().max(5_000) },
      run: forward('set_node_comment', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'set_documentation',
      title: 'Replace the documentation',
      description:
        'Replace the documentation of the function on screen (the one `get_documentation` ' +
        'reads) with `text`, which is Markdown; an empty `text` clears it. It replaces all of ' +
        'it, so call `get_documentation` first and send the full new text. To show an image, ' +
        'add it with `add_image`, whose result gives the Markdown to include. The user sees ' +
        'the documentation in the documentation panel. Returns `{ method, characters, ' +
        'settled }` (`characters`: the length of the text; `settled` is always true: nothing ' +
        'is computed again); a `text` equal to the documentation when the edit runs changes ' +
        'nothing and adds `unchanged: true` (it is still refused in Live mode).' +
        EDIT_RULES,
      inputSchema: { text: z.string().max(DOCUMENTATION_CHARS) },
      run: forward('set_documentation', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'set_visualization',
      title: 'Show, hide or resize a visualization',
      description:
        'Show (`visible` true) or hide the visualization of the node `node_id` (from ' +
        '`get_graph`) in the graph editor, for the user to look at. `width` and `height` ' +
        '(optional) set its size in scene units (pixels at 100% zoom), 100 to 2,000 each, ' +
        'or `null` for the default (the width of the node or 200, and 150 high); one left out ' +
        'stays as it is, and a size given with `visible` false is stored while the ' +
        'visualization stays hidden. All of it is one edit. A larger visualization pushes the nodes around ' +
        'it away, and they return when it shrinks. The size stays as set and is part of your ' +
        'undo step: when the user did not ask for a large one, pass `null` for both to put it ' +
        'back to the small default when you are done. The view never draws it narrower than ' +
        'the node or 200, nor lower than 32. Returns `node`, the node, `size`, `{ width, ' +
        'height, default_width, default_height }` (as drawn, and whether each is the ' +
        'default), and `settled` (always true: nothing is computed again).' +
        EDIT_RULES,
      inputSchema: {
        node_id: nodeId(),
        visible: z.boolean(),
        width: visualizationSize(),
        height: visualizationSize(),
      },
      run: forward('set_visualization', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'move_nodes',
      title: 'Move nodes',
      description:
        'Move nodes in the graph editor. Each of `moves` is `{ node_id, x, y }`: the new ' +
        "position of the node's top-left, in scene units (pixels at 100% zoom, x to the right, " +
        "y down). Read the current positions with `get_graph { layout: true }`; a node's " +
        '`area` shows the room it needs, its visualization included, so leave a gap between ' +
        'areas. All the moves are one edit; nodes the moved ones were pushing aside return to ' +
        'their places. An unknown node, or the same node twice, refuses the whole call and ' +
        'nothing moves. For a tidy result prefer `arrange_nodes`. Returns `moved`, each ' +
        'node `{ id, position }` as stored afterwards, and `settled` (always true: nothing is ' +
        'computed again).' +
        EDIT_RULES,
      inputSchema: {
        moves: z
          .array(
            z.object({
              node_id: nodeId(),
              x: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
              y: z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
            }),
          )
          .min(1)
          .max(MOVE_NODES_MAX),
      },
      run: forward('move_nodes', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'arrange_nodes',
      title: 'Arrange nodes',
      description:
        "Lay nodes out with the graph editor's own commands, as the user would. `action`: " +
        '`tidy` (Tidy up: lays out the nodes of `node_ids`, or the whole graph without ' +
        '`node_ids` or with fewer than two); `align_left`, `align_right`, `align_center`, ' +
        '`align_top`, `align_bottom` (Align: line the nodes up on that edge or centre); ' +
        '`space`, `space_tight`, `space_wide`, `space_none` (Spacing: stack the nodes ' +
        'vertically with the default, tight, wide or no gap). The Align and Spacing actions ' +
        'need at least two nodes in `node_ids` (ids from `get_graph`). An unknown or repeated ' +
        'node refuses the call and nothing moves. All of it is one edit; the view and the ' +
        'selection do not change. Returns `{ action, arranged, settled }`: `arranged`, the ' +
        'number of nodes whose position changed (0 when they were already laid out), and ' +
        '`settled` (always true: nothing is computed again). Read the new positions with ' +
        '`get_graph { layout: true }`.' +
        EDIT_RULES,
      inputSchema: {
        action: z.enum([
          'tidy',
          'align_left',
          'align_right',
          'align_center',
          'align_top',
          'align_bottom',
          'space',
          'space_tight',
          'space_wide',
          'space_none',
        ]),
        node_ids: z.array(nodeId()).max(ARRANGE_NODES_MAX).optional(),
      },
      run: forward('arrange_nodes', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'undo',
      title: "Undo the agents' last edits",
      description:
        'Take back the most recent step of edits made by any connected agent, not only yours. ' +
        'A step is usually every edit made without a 10 second pause, but one `undo` may take ' +
        'back only part of it: check `can_undo` and call `get_graph`. It does not go past the ' +
        "user's last change: it takes back only agents' edits made since the user last changed " +
        'the project, and is refused when there are none. Refused while the project is in Live ' +
        "mode, and while the project's main module has code that enables output (such as " +
        '`with_enabled_context`, in any node or function), because ' +
        'undoing could run that code and write: ask the user to undo with Ctrl+Z then. Returns ' +
        '`undone`, `can_undo` and `can_redo` (whether another call would do something). It does ' +
        'not wait for the engine: values may still be computing, so call `get_graph`, where a ' +
        'node still computing has `state` `pending`. Nodes that come back have the ids they ' +
        'had before.',
      inputSchema: {},
      run: forward('undo', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'redo',
      title: 'Redo what undo took back',
      description:
        'Re-apply what `undo` took back, a step at a time. Refused when there is nothing to ' +
        'redo: an edit by anyone since the `undo` ends it. Refused while the project is in Live ' +
        "mode, and while the project's main module has code that enables output (such as " +
        '`with_enabled_context`, in any node or function), because ' +
        'redoing could run that code and write: ask the user to redo with Ctrl+Y then. Returns ' +
        '`redone`, `can_undo` and `can_redo`. It does not wait for the engine: values may still ' +
        'be computing, so call `get_graph`, where a node still computing has ' +
        '`state` `pending`.',
      inputSchema: {},
      run: forward('redo', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'save_version',
      title: 'Save a version of the project',
      description:
        "Save a version of the project in its local git repository, as the user's Save a " +
        'version does, with `comment` (one line, at most 500 characters; without one the ' +
        'version says it was saved by you). Returns `saved: true`, or `saved: false` with the ' +
        '`reason` when nothing has changed since the last version. Refused when versions are ' +
        'not kept for the project: only the user turns them on, with Save a version. It ' +
        'changes no node, so it works in Live mode too and does not end your undo step. The ' +
        'project is also saved as a version before your first edit.',
      inputSchema: {
        comment: z
          .string()
          .max(VERSION_COMMENT_CHARS)
          .refine((text) => !/[\r\n]/.test(text), 'The comment must be one line.')
          .optional(),
      },
      run: forward('save_version', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'refresh',
      title: 'Refresh the values',
      description:
        "Compute every node again in Design mode, as the user's Refresh button does, reading " +
        'files and data sources again. Use it after the user changed a file or a table outside ' +
        'the IDE. It never turns Write on and never runs a node in Live: it is refused while ' +
        "the project is in Live mode, and when the project's main module (the module the graph " +
        'shows) has code that enables output anywhere (the forms the edit tools refuse, such as ' +
        '`with_enabled_context`), because a refresh would run it and write again (ask the user to ' +
        "refresh then). It does not check the project's other modules, library functions that " +
        'turn output on themselves, or `foreign` code: do not refresh a project that writes ' +
        'through them. It changes no node and joins no undo step; it ends yours. Returns ' +
        '`refreshed` and `settled`: whether the engine reported every computed node of the function on ' +
        'screen again in time. Call `get_graph` or `get_problems` afterwards.',
      inputSchema: {},
      run: forward('refresh', EDIT_TOOL_TIMEOUT_MS),
    },
    {
      name: 'select_nodes',
      title: 'Select nodes',
      description:
        'Select the nodes in `node_ids` (from `get_graph`) in the graph editor, to point ' +
        'the user at them; an empty list clears the selection. This and `open_method` are ' +
        'the only project tools that change the selection, and with `get_visualization` and ' +
        '`get_graph_image` the only ones that move the view: the edit tools leave both alone. ' +
        'Returns `selected`, ' +
        'the ids of the selected nodes. Works in Live mode too.',
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
