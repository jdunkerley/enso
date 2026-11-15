/**
 * @file The node edit MCP tools: `add_nodes`, `edit_node`, `remove_nodes`, `set_node_comment` and
 * `set_visualization`. Pure functions over {@link EditToolDeps}. Each validates its arguments
 * before entering the edit session, so a refused call changes nothing; the session refuses in
 * Live mode, keeps the agent's edits in one undo step, and waits for the graph to settle.
 */
import type { Node, NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Ast } from '@/util/ast'
import { nodeMutableDocumentation } from '@/util/ast/node'
import { isIdentifier } from '@/util/qualifiedName'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import type { EditOutcome, EditSession } from './editSession'
import {
  capNodeTexts,
  findNode,
  jsonResult,
  summarizeNode,
  truncate,
  type GraphToolDeps,
  type NodeSummary,
} from './graphTools'
import { hasSyntaxError, parseImportLines, quote } from './importLines'

/** Added to a result whose edit was not followed by a finished execution in time. */
export const UNSETTLED_NOTE =
  'Execution has not finished. Call get_node later for the types and values.'
/** Added to an `add_nodes` result when some new nodes are not in the node database yet. */
export const MISSING_NODES_NOTE =
  'Some new nodes are not in the graph on screen yet. Call get_graph for them.'
/** Most characters of an error from the session or a dependency. */
export const EDIT_ERROR_CHARS = 2_000

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
 * for an import line and for anything the parser marks invalid.
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
  return Ok(ast)
}

function functionDefError(ast: Ast.FunctionDef, quoted: string): Result<never> {
  return ast.body == null ?
      Err(`\`${quoted}\` has no expression after \`=\`.`)
    : Err(`\`${quoted}\` is a function definition. Add functions with add_function.`)
}

/** A lexical identifier starting with a lowercase letter: what a node can be named. */
function isPlainName(name: string): boolean {
  return isIdentifier(name) && /^[a-z]/.test(name)
}

export interface EditToolDeps extends GraphToolDeps {
  readonly session: Pick<EditSession, 'run'>
  readonly caller: McpCaller
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
  readonly setVisualization: (id: NodeId, visible: boolean) => Result<void>
}

type FoundNode = { id: NodeId; node: Node }

/**
 * Adds one node per statement, all in one module edit, after `after_node` when given, and adds
 * the import lines the module lacks. Refused, before anything changes, when a statement or import
 * does not parse, a name is bound twice, or `after_node` is unknown; and, at the call's turn in
 * the edit session, when a name is already used in the method.
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
  const outcome = await deps.session.run(deps.caller, () => {
    // Checked at the call's turn in the queue: an earlier edit may have taken the name since.
    const taken = [...bound].find((name) => deps.db.identifierUsed(name))
    if (taken != null) {
      return Err(
        `The name \`${quote(taken)}\` is already used in the method. ` +
          'Choose another name, or change that node with edit_node.',
      )
    }
    return deps.createNodes(nodes, after, imports)
  })
  if (!outcome.ok) return errorResult(outcome)
  const summaries: NodeSummary[] = []
  for (const id of outcome.value.value) {
    const node = deps.db.nodeIdToNode.get(id)
    if (node != null) summaries.push(summary(deps, id, node))
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

/** Replaces the expression of a node, which keeps its name. Answers with the node. */
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
  const expression = parseNodeExpression(args.expression)
  if (!expression.ok) return errorResult(expression)
  const outcome = await deps.session.run(deps.caller, () =>
    deps.setNodeContent(id, expression.value),
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ nodes: [currentSummary(deps, found.value)] }, outcome.value)
}

/**
 * Removes the nodes. Refused, before anything changes, when any id is unknown or names the
 * method's argument or output. Answers with the ids removed.
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
  const outcome = await deps.session.run(deps.caller, () => deps.deleteNodes(ids))
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ removed: ids }, outcome.value)
}

/** Sets a node's documentation comment; an empty text removes it. Answers with the node. */
export async function setNodeComment(
  deps: EditToolDeps,
  args: { node_id: string; text: string },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  if (nodeMutableDocumentation(found.value.node) == null) {
    return toolError(`Node ${args.node_id} cannot have a comment.`)
  }
  const outcome = await deps.session.run(deps.caller, () =>
    deps.setNodeComment(found.value.id, args.text),
  )
  if (!outcome.ok) return errorResult(outcome)
  return jsonResult({ node: currentSummary(deps, found.value) })
}

/** Shows or hides a node's visualization. Answers with the node. */
export async function setVisualization(
  deps: EditToolDeps,
  args: { node_id: string; visible: boolean },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  const outcome = await deps.session.run(deps.caller, () =>
    deps.setVisualization(found.value.id, args.visible),
  )
  if (!outcome.ok) return errorResult(outcome)
  return jsonResult({ node: currentSummary(deps, found.value) })
}

function summary(deps: GraphToolDeps, id: NodeId, node: Node): NodeSummary {
  return capNodeTexts(summarizeNode(deps, id, node))
}

/** The node's summary as the graph has it after the edit; as found before, if it is gone. */
function currentSummary(deps: GraphToolDeps, { id, node }: FoundNode): NodeSummary {
  return summary(deps, id, deps.db.nodeIdToNode.get(id) ?? node)
}

/** `value` with `settled`, and the note when execution has not finished. */
function settledResult(value: object, outcome: EditOutcome<unknown>): McpToolResult {
  return jsonResult({
    ...value,
    settled: outcome.settled,
    ...(outcome.settled ? {} : { note: UNSETTLED_NOTE }),
  })
}

function toolError(error: string): McpToolResult {
  return { ok: false, error }
}

function errorResult(
  result: { ok: false; error: { message(preamble: string): string } },
  preamble = '',
) {
  return toolError(truncate(result.error.message(preamble), EDIT_ERROR_CHARS))
}
