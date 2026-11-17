/**
 * @file The node edit MCP tools: `add_nodes`, `edit_node`, `remove_nodes`, `set_node_comment` and
 * `set_visualization`. Pure functions over {@link EditToolDeps}. Each validates its arguments
 * before entering the edit session, so a refused call changes nothing; the session refuses in
 * Live mode, keeps the agent's edits in one undo step, and waits for the graph to settle.
 */
import type { Node, NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Ast } from '@/util/ast'
import { nodeMutableDocumentation } from '@/util/ast/node'
import { methodPointerEquals, type MethodPointer } from '@/util/methodPointer'
import { isIdentifier, type Identifier } from '@/util/qualifiedName'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'
import type { EditOutcome, EditSession } from './editSession'
import {
  capNodeTexts,
  findNode,
  jsonResult,
  summarizeNode,
  truncate,
  unknownNodeError,
  type GraphToolDeps,
  type NodeSummary,
} from './graphTools'
import { hasSyntaxError, parseImportLines, quote } from './importLines'
import type { VisualizationSize } from './visualizationTools'
import { writeRefusal } from './writeGuard'

/** Added to a result whose edit was not followed by a finished execution in time. */
export const UNSETTLED_NOTE =
  'The engine had not reported results for the changed nodes within 20 seconds: call get_node later.'
/** Added to an `add_nodes` result when some new nodes are not in the node database yet. */
export const MISSING_NODES_NOTE =
  'Some new nodes are not in the graph on screen yet. Call get_graph for them.'
/** The answer to an edit whose turn comes after the method on screen changed. */
export const METHOD_CHANGED_ERROR =
  'The method on screen changed before this edit ran. Nothing was changed; call get_graph and try again.'
/** Most characters of an error from the session or a dependency. */
export const EDIT_ERROR_CHARS = 2_000
/** The smallest width or height, in scene units, `set_visualization` sets. */
export const VISUALIZATION_SIZE_MIN = 100
/** The largest width or height, in scene units, `set_visualization` sets. */
export const VISUALIZATION_SIZE_MAX = 2_000

export interface ParsedStatement {
  readonly binding: string | undefined
  readonly expression: string
}

/**
 * `name = expr` → binding and expression; a bare expression → no binding. An expression may
 * continue on indented lines. Err for anything that is not one such statement: a function
 * definition, an import, a syntax error, an empty line, several statements, or a left-hand side
 * that is not a plain lowercase name.
 */
export function parseNodeStatement(statement: string): Result<ParsedStatement> {
  const quoted = quote(statement)
  const parsed = parseMethodStatement(
    statement,
    `\`${quoted}\` is not one statement. ` +
      'Pass one statement per entry: `name = expression` or an expression.',
  )
  if (!parsed.ok) return parsed
  const ast = parsed.value
  if (ast instanceof Ast.Assignment) {
    const name = ast.pattern.code()
    if (!(ast.pattern instanceof Ast.Ident) || !isPlainName(name)) {
      return Err(
        'Bind one name on the left of `=`, as in `name = expression`: ' +
          `\`${quote(name)}\` in \`${quoted}\` is not a plain lowercase name.`,
      )
    }
    return Ok({ binding: name, expression: ast.expression.code() })
  }
  if (ast instanceof Ast.ExpressionStatement) {
    return Ok({ binding: undefined, expression: ast.expression.code() })
  }
  if (ast instanceof Ast.FunctionDef) return functionDefError(ast, quoted)
  return Err(`\`${quoted}\` is not a node statement. Pass \`name = expression\` or an expression.`)
}

/**
 * The text of an expression a node can hold, as its new right-hand side; it may continue on
 * indented lines. Err for anything else: an assignment (the node keeps its name), an import, a
 * function or type definition, several statements, an empty text, or a syntax error.
 *
 * It is checked as a statement of a method body, not with `Ast.parseExpression`, which takes an
 * import line for an expression.
 */
export function parseNodeExpression(expression: string): Result<string> {
  const quoted = quote(expression)
  const parsed = parseMethodStatement(
    expression,
    `\`${quoted}\` is not one expression. Pass the new right-hand side only.`,
  )
  if (!parsed.ok) return parsed
  const ast = parsed.value
  if (ast instanceof Ast.ExpressionStatement) return Ok(ast.expression.code())
  if (ast instanceof Ast.Assignment) {
    return Err(`\`${quoted}\` is an assignment. Give only the expression; the node keeps its name.`)
  }
  if (ast instanceof Ast.FunctionDef) return functionDefError(ast, quoted)
  return Err(`\`${quoted}\` is not an expression. Pass the new right-hand side only.`)
}

/**
 * `text` parsed as one statement of a method body. Err (`notOne` when it is not one statement)
 * for an import line, for anything the parser marks invalid, and for code that turns the output
 * context on ({@link writeRefusal}).
 */
function parseMethodStatement(text: string, notOne: string): Result<Ast.Statement> {
  const quoted = quote(text)
  const ast = Ast.parseBlockStatement(text)
  if (ast == null) return Err(notOne)
  // In a method body an import line parses as an ordinary expression; at the top level it is one.
  if (Ast.parseModuleStatement(text) instanceof Ast.Import) {
    return Err(`\`${quoted}\` is an import. Pass import lines in \`imports\` of add_nodes.`)
  }
  if (hasSyntaxError(ast)) return Err(`\`${quoted}\` has a syntax error.`)
  const refusal = writeRefusal(ast)
  if (refusal != null) return Err(refusal)
  return Ok(ast)
}

function functionDefError(ast: Ast.FunctionDef, quoted: string): Result<never> {
  return ast.body == null ?
      Err(`\`${quoted}\` has no expression after \`=\`.`)
    : Err(`\`${quoted}\` is a function definition. Add functions with add_function.`)
}

/** A lexical identifier starting with a lowercase letter: what a node or a function can be named. */
export function isPlainName(name: string): name is Identifier {
  return isIdentifier(name) && /^[a-z]/.test(name)
}

export interface EditToolDeps extends GraphToolDeps {
  readonly session: Pick<EditSession, 'run'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
  /**
   * Creates the nodes in one module edit, placed without overlapping each other or existing nodes,
   * near `after` when given; resolves with their ids in order. Does not select or pan.
   */
  readonly createNodes: (
    nodes: readonly ParsedStatement[],
    after: NodeId | undefined,
    importLines: readonly string[],
  ) => Promise<Result<NodeId[]>>
  readonly setNodeContent: (id: NodeId, expression: string) => Result<void>
  readonly deleteNodes: (ids: readonly NodeId[]) => Promise<Result<void>>
  readonly setNodeComment: (id: NodeId, text: string) => Result<void>
  /**
   * Writes the node's visualization metadata in one `graph.setNodeVisualization` call: shows or
   * hides it, and sets the identifier, width and height given (null: the default size); a key left
   * out keeps its value.
   */
  readonly setVisualization: (id: NodeId, update: VisualizationUpdate) => Result<void>
  /** The size of the node's visualization as drawn, from its metadata as the graph has it now. */
  readonly visualizationSize: (id: NodeId) => VisualizationSize
}

/** What `set_visualization` writes to a node's visualization metadata, in one edit. */
export interface VisualizationUpdate {
  readonly visible: boolean
  readonly identifier?: VisualizationIdentifier
  /** In scene units; null for the default. */
  readonly width?: number | null
  /** In scene units; null for the default. */
  readonly height?: number | null
}

type FoundNode = { id: NodeId; node: Node }

/** The method on screen now, as a tool records it when it validates its arguments. */
export function methodOnScreen(deps: Pick<GraphToolDeps, 'currentMethod'>): MethodPointer | null {
  const pointer = deps.currentMethod.pointer
  return pointer.ok ? pointer.value : null
}

/**
 * Checked inside an edit, at its turn in the session's queue and before it changes anything: the
 * user or `open_method` may have changed the method on screen since the call was validated, or
 * removed one of its nodes. Err ({@link METHOD_CHANGED_ERROR}) when the method on screen is not
 * `method`, or the unknown-id error for the first of `ids` no longer in the method.
 */
export function checkAtTurn(
  deps: Pick<GraphToolDeps, 'currentMethod' | 'db'>,
  method: MethodPointer | null,
  ids: readonly NodeId[] = [],
): Result<void> {
  const now = methodOnScreen(deps)
  const same = now == null || method == null ? now === method : methodPointerEquals(now, method)
  if (!same) return Err(METHOD_CHANGED_ERROR)
  const gone = ids.find((id) => !deps.db.nodeIdToNode.has(id))
  return gone != null ? Err(unknownNodeError(gone)) : Ok()
}

/**
 * Adds one node per statement, all in one module edit, after `after_node` when given, and adds
 * the import lines the module lacks. Refused, before anything changes, when a statement or import
 * does not parse, a name is bound twice, or `after_node` is unknown; and, at the call's turn in
 * the edit session, when a name is already used in the method, the method on screen changed or
 * `after_node` is gone ({@link checkAtTurn}).
 * Answers with the new nodes, in order, without previews.
 */
export async function addNodes(
  deps: EditToolDeps,
  args: { statements: string[]; after_node?: string; imports?: string[] },
): Promise<McpToolResult> {
  let after: NodeId | undefined
  if (args.after_node != null) {
    const found = findNode(deps.db, args.after_node)
    if (!found.ok) return found
    after = found.value.id
  }
  const method = methodOnScreen(deps)
  const imports = args.imports ?? []
  const parsedImports = parseImportLines(imports)
  if (!parsedImports.ok) return errorResult(parsedImports)
  const nodes: ParsedStatement[] = []
  const bound = new Set<string>()
  for (const [index, statement] of args.statements.entries()) {
    const parsed = parseNodeStatement(statement)
    if (!parsed.ok) return errorResult(parsed, `Statement ${index + 1}`)
    const { binding } = parsed.value
    if (binding != null) {
      if (bound.has(binding)) {
        return toolError(`The name \`${quote(binding)}\` is bound twice in this call.`)
      }
      bound.add(binding)
    }
    nodes.push(parsed.value)
  }
  const outcome = await deps.session.run(
    deps.caller,
    () => {
      const unchanged = checkAtTurn(deps, method, after != null ? [after] : [])
      if (!unchanged.ok) return unchanged
      // Checked at the call's turn in the queue: an earlier edit may have taken the name since.
      const taken = [...bound].find((name) => deps.db.identifierUsed(name))
      if (taken != null) {
        return Err(
          `The name \`${quote(taken)}\` is already used in the method. ` +
            'Choose another name, or change that node with edit_node.',
        )
      }
      return deps.createNodes(nodes, after, imports)
    },
    // The engine reports a value for each new node.
    { affected: (ids) => ({ added: ids }), deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  const summaries: NodeSummary[] = []
  for (const id of outcome.value.value) {
    const node = deps.db.nodeIdToNode.get(id)
    if (node != null) summaries.push(cappedSummary(deps, id, node))
  }
  const notes = [
    ...(outcome.value.settled ? [] : [UNSETTLED_NOTE]),
    ...(summaries.length < outcome.value.value.length ? [MISSING_NODES_NOTE] : []),
  ]
  return jsonResult({
    nodes: summaries,
    settled: outcome.value.settled,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  })
}

/**
 * The answer to `edit_node` on a node the user turned Write on for. Its expression runs with the
 * output context on, so an expression an agent put there would write: only the user changes it.
 */
export function writeOnNodeError(nodeId: string): string {
  return (
    `Node ${quote(nodeId)} runs with Write on, which only the user turns on or off. ` +
    'Ask the user to turn Write off on it before you change it.'
  )
}

/**
 * Replaces the expression of a node, which keeps its name. Answers with the node. A node the user
 * turned Write on for is refused ({@link writeOnNodeError}): the edit would replace only the
 * expression inside the user's Write prefix, which would then run the agent's code with output.
 */
export async function editNode(
  deps: EditToolDeps,
  args: { node_id: string; expression: string },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  const { id, node } = found.value
  if (node.type === 'input') {
    return toolError(`Node ${args.node_id} is an argument of the method and cannot be edited.`)
  }
  if (node.prefixes.enableRecording != null) return toolError(writeOnNodeError(args.node_id))
  const expression = parseNodeExpression(args.expression)
  if (!expression.ok) return errorResult(expression)
  const method = methodOnScreen(deps)
  let codeChanged = true
  const outcome = await deps.session.run(
    deps.caller,
    () => {
      const unchanged = checkAtTurn(deps, method, [id])
      if (!unchanged.ok) return unchanged
      const current = deps.db.nodeIdToNode.get(id)
      // The user may have turned Write on for it while the edit waited.
      if (current?.prefixes.enableRecording != null) return Err(writeOnNodeError(args.node_id))
      codeChanged = current?.innerExpr.code() !== expression.value
      return deps.setNodeContent(id, expression.value)
    },
    {
      // The node existed before: its result counts once the engine has taken this edit up. The
      // code it already has changes nothing, and the engine then reports nothing (packaged app).
      affected: () => (codeChanged ? { changed: [id] } : {}),
      deadline: deps.deadline,
    },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ nodes: [currentSummary(deps, found.value)] }, outcome.value)
}

/**
 * Removes the nodes. Refused, before anything changes, when any id is unknown or names the
 * method's argument or output. Answers with the ids removed. Removing a node the user turned Write
 * on for seals the agents' undo history (see `EditRunOptions.sealsHistory`).
 */
export async function removeNodes(
  deps: EditToolDeps,
  args: { node_ids: string[] },
): Promise<McpToolResult> {
  const ids: NodeId[] = []
  for (const nodeId of args.node_ids) {
    const found = findNode(deps.db, nodeId)
    if (!found.ok) return found
    const { id, node } = found.value
    if (node.type !== 'component') {
      const role = node.type === 'input' ? 'an argument' : 'the output'
      return toolError(`Node ${nodeId} is ${role} of the method and cannot be removed.`)
    }
    if (!ids.includes(id)) ids.push(id)
  }
  // The nodes that used a removed one lose that input and are computed again. Read at the call's
  // turn, before the deletion, from the usages `deleteNodes` disconnects.
  let users: NodeId[] = []
  // Whether a removed node has Write on, read at the turn, before the deletion.
  let removesWriteOn = false
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    () => {
      // Else `deleteNodes` skips an id that is gone, and the answer would list it as removed.
      const unchanged = checkAtTurn(deps, method, ids)
      if (!unchanged.ok) return unchanged
      users = dependentsOf(deps, ids)
      removesWriteOn = ids.some(
        (id) => deps.db.nodeIdToNode.get(id)?.prefixes.enableRecording != null,
      )
      return deps.deleteNodes(ids)
    },
    {
      affected: () => ({ changed: users }),
      deadline: deps.deadline,
      // Undoing the removal would bring the node back and run it with Write on.
      sealsHistory: () => removesWriteOn,
    },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ removed: ids }, outcome.value)
}

/**
 * Sets a node's documentation comment; an empty text removes it. Answers with the node and
 * `settled: true` (nothing is computed again).
 */
export async function setNodeComment(
  deps: EditToolDeps,
  args: { node_id: string; text: string },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  if (nodeMutableDocumentation(found.value.node) == null) {
    return toolError(`Node ${args.node_id} cannot have a comment.`)
  }
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    // A comment changes nothing the engine runs: no expression is affected, so it settles at once.
    () => {
      const unchanged = checkAtTurn(deps, method, [found.value.id])
      if (!unchanged.ok) return unchanged
      return deps.setNodeComment(found.value.id, args.text)
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ node: currentSummary(deps, found.value) }, outcome.value)
}

/**
 * Shows or hides a node's visualization, and in the same edit sets its `width` and `height` when
 * given (null: the default) and switches it to `identifier` when one is given (`get_visualization`
 * does; the `set_visualization` tool never passes one). A size outside
 * {@link VISUALIZATION_SIZE_MIN} to {@link VISUALIZATION_SIZE_MAX} is refused before anything
 * changes. Answers with the node, the size as drawn after the edit and `settled: true` (nothing
 * is computed again).
 */
export async function setVisualization(
  deps: EditToolDeps,
  args: {
    node_id: string
    visible: boolean
    identifier?: VisualizationIdentifier
    width?: number | null
    height?: number | null
  },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  for (const dimension of ['width', 'height'] as const) {
    const value = args[dimension]
    if (value != null && !isVisualizationSize(value)) {
      return toolError(
        `The \`${dimension}\` must be 100 to 2,000 scene units, or null for the default size.`,
      )
    }
  }
  const update: VisualizationUpdate = {
    visible: args.visible,
    ...(args.identifier != null ? { identifier: args.identifier } : {}),
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
  }
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    // A visualization changes nothing the engine runs for the graph: no expression is affected,
    // so it settles at once.
    () => {
      const unchanged = checkAtTurn(deps, method, [found.value.id])
      if (!unchanged.ok) return unchanged
      return deps.setVisualization(found.value.id, update)
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult(
    { node: currentSummary(deps, found.value), size: deps.visualizationSize(found.value.id) },
    outcome.value,
  )
}

function isVisualizationSize(value: number): boolean {
  return (
    Number.isFinite(value) && value >= VISUALIZATION_SIZE_MIN && value <= VISUALIZATION_SIZE_MAX
  )
}

/** The nodes, other than `removed`, that use any of `removed`. */
function dependentsOf(deps: EditToolDeps, removed: readonly NodeId[]): NodeId[] {
  const users = new Set<NodeId>()
  for (const id of removed) {
    for (const user of deps.db.nodeDependents.lookup(id)) {
      if (!removed.includes(user)) users.add(user)
    }
  }
  return [...users]
}

/** The node's summary, its texts capped as `get_graph` caps them. */
export function cappedSummary(deps: GraphToolDeps, id: NodeId, node: Node): NodeSummary {
  return capNodeTexts(summarizeNode(deps, id, node))
}

/** The node's summary as the graph has it after the edit; as found before, if it is gone. */
function currentSummary(deps: GraphToolDeps, { id, node }: FoundNode): NodeSummary {
  return cappedSummary(deps, id, deps.db.nodeIdToNode.get(id) ?? node)
}

/** `value` with `settled`, and the note when execution has not finished. */
export function settledResult(value: object, outcome: EditOutcome<unknown>): McpToolResult {
  return jsonResult({
    ...value,
    settled: outcome.settled,
    ...(outcome.settled ? {} : { note: UNSETTLED_NOTE }),
  })
}

/** A refusal with this text. */
export function toolError(error: string): McpToolResult {
  return { ok: false, error }
}

/** A refusal with the error's text (after `preamble`), capped at {@link EDIT_ERROR_CHARS}. */
export function errorResult(
  result: { ok: false; error: { message(preamble: string): string } },
  preamble = '',
) {
  return toolError(truncate(result.error.message(preamble), EDIT_ERROR_CHARS))
}
