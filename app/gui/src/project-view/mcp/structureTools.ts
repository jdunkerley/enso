/**
 * @file The MCP tools that change the module's structure: `collapse_nodes` (group nodes into a new
 * function, as the graph editor's "Group components" does) and `add_function` (add a top-level
 * function written from scratch). Pure functions over {@link StructureToolDeps}. Each validates
 * its arguments before entering the edit session, so a refused call changes nothing.
 */
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { CollapseOutcome } from '@/components/GraphEditor/collapseNodes'
import { Ast } from '@/util/ast'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import {
  cappedSummary,
  checkAtTurn,
  errorResult,
  isPlainName,
  methodOnScreen,
  MISSING_NODES_NOTE,
  settledResult,
  toolError,
  UNSETTLED_NOTE,
  type EditToolDeps,
} from './editTools'
import { findNode, jsonResult, type GraphToolDeps } from './graphTools'
import { hasSyntaxError, quote } from './importLines'
import { enablesOutput, WRITE_REFUSED_ERROR } from './writeGuard'

export interface StructureToolDeps
  extends GraphToolDeps, Pick<EditToolDeps, 'session' | 'caller' | 'deadline'> {
  /**
   * Collapses the component nodes into a new function named `name` (a generated name without it;
   * a number is added when the name is taken), in one module edit. See `collapseNodes` in
   * `components/GraphEditor/collapseNodes.ts`.
   */
  readonly collapseNodes: (
    ids: readonly NodeId[],
    name: Identifier | undefined,
  ) => Result<CollapseOutcome>
  /** Runs `f` on the module's top-level block in one module edit, committed when `f` returns Ok. */
  readonly editModule: <T>(f: (topLevel: Ast.MutableBodyBlock) => Result<T>) => Result<T>
  /** Adds, in `edit`, the imports that the type names used in `scope` need. */
  readonly addDetectedImports: (edit: Ast.MutableModule, scope: Ast.Ast) => void
}

/**
 * Collapses the nodes into a new function, replaced in the graph by one node calling it. Refused,
 * before anything changes, when `name` is not a lowercase identifier, or an id is unknown or names
 * the method's argument or output; and, at the call's turn, when the nodes cannot be collapsed
 * (more than one of them is used by other nodes). Answers with the function's name and the new
 * node.
 */
export async function collapseNodesTool(
  deps: StructureToolDeps,
  args: { node_ids: string[]; name?: string },
): Promise<McpToolResult> {
  if (args.name != null && !isPlainName(args.name)) {
    return toolError(
      `\`${quote(args.name)}\` is not a valid function name. ` +
        'Use a lowercase name such as `clean_names`.',
    )
  }
  const name = args.name
  const ids: NodeId[] = []
  for (const nodeId of args.node_ids) {
    const found = findNode(deps.db, nodeId)
    if (!found.ok) return found
    const { id, node } = found.value
    if (node.type !== 'component') {
      const role = node.type === 'input' ? 'an argument' : 'the output'
      return toolError(`Node ${nodeId} is ${role} of the method and cannot be collapsed.`)
    }
    if (!ids.includes(id)) ids.push(id)
  }
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    () => {
      const unchanged = checkAtTurn(deps, method, ids)
      if (!unchanged.ok) return unchanged
      return deps.collapseNodes(ids, name)
    },
    {
      // The engine reports a value for the new node that calls the function.
      affected: ({ callNode }) => (callNode != null ? [callNode] : []),
      deadline: deps.deadline,
    },
  )
  if (!outcome.ok) return errorResult(outcome)
  const { name: functionName, callNode } = outcome.value.value
  const node = callNode != null ? deps.db.nodeIdToNode.get(callNode) : undefined
  const settled = outcome.value.settled
  const notes = [
    ...(settled ? [] : [UNSETTLED_NOTE]),
    ...(node == null ? [MISSING_NODES_NOTE] : []),
  ]
  return jsonResult({
    name: functionName,
    node: callNode != null && node != null ? cappedSummary(deps, callNode, node) : null,
    settled,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  })
}

/**
 * The name of the function `source` defines. Err for anything that is not exactly one top-level
 * function definition with a body and a lowercase name: an expression, an import, a type
 * definition, several statements, an empty text, a syntax error, an extension method or an
 * operator; and code that turns the output context on ({@link enablesOutput}). `name = value` is
 * accepted: at the top level it is a method without arguments.
 */
export function parseFunctionDefinition(source: string): Result<Identifier> {
  const quoted = quote(source)
  const ast = Ast.parseModuleStatement(source)
  if (ast == null) {
    return Err(`\`${quoted}\` is not one function definition. Pass one definition per call.`)
  }
  if (ast instanceof Ast.Import) {
    return Err(`\`${quoted}\` is an import. Pass import lines in \`imports\` of add_nodes.`)
  }
  if (hasSyntaxError(ast)) return Err(`\`${quoted}\` has a syntax error.`)
  if (enablesOutput(ast)) return Err(WRITE_REFUSED_ERROR)
  if (!(ast instanceof Ast.FunctionDef)) {
    return Err(
      `\`${quoted}\` is not a function definition. ` +
        'Pass a name, its arguments, `=` and a body, as in `double x = x * 2`.',
    )
  }
  if (ast.body == null) return Err(`\`${quoted}\` has no body after \`=\`.`)
  const name = ast.name.code()
  if (!isPlainName(name)) {
    return Err(
      `The function name \`${quote(name)}\` is not a plain lowercase name. ` +
        'Name the function as in `double x = x * 2`.',
    )
  }
  return Ok(name)
}

/**
 * Adds the function `source` defines to the module, before the method on screen, with the imports
 * its type names need. Refused, before anything changes, when `source` is not one function
 * definition; and, at the call's turn, when its name is already defined at the top level.
 * Answers with the function's name.
 */
export async function addFunction(
  deps: StructureToolDeps,
  args: { source: string },
): Promise<McpToolResult> {
  const parsed = parseFunctionDefinition(args.source)
  if (!parsed.ok) return errorResult(parsed)
  const name = parsed.value
  // A definition alone affects nothing the engine runs: the nodes that will call it are added
  // later, and their own edit waits for their values.
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    () => {
      // The function goes before the method on screen: the one the call was validated against.
      const unchanged = checkAtTurn(deps, method)
      if (!unchanged.ok) return unchanged
      return deps.editModule((topLevel) => insertFunction(deps, topLevel, args.source, name))
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ name }, outcome.value)
}

function insertFunction(
  deps: StructureToolDeps,
  topLevel: Ast.MutableBodyBlock,
  source: string,
  name: Identifier,
): Result<Identifier> {
  // Checked at the call's turn in the queue: an earlier edit may have added the name since.
  if (Ast.findModuleMethod(topLevel, name) != null) {
    return Err(
      `A function named \`${name}\` is already defined in the module. Choose another name.`,
    )
  }
  const { pointer } = deps.currentMethod
  if (!pointer.ok) return pointer
  const currentMethod = Ast.findModuleMethod(topLevel, pointer.value.name)
  if (currentMethod == null) {
    return Err(`The method \`${pointer.value.name}\` on screen is not in the module.`)
  }
  const edit = topLevel.module
  // Parsed again into `edit`: the validated copy lives in a transient module.
  const definition = Ast.parseModuleStatement(source, edit)
  if (definition == null) return Err(`\`${quote(source)}\` is not one function definition.`)
  topLevel.insert(currentMethod.index, definition, undefined)
  deps.addDetectedImports(edit, edit.get(definition.id))
  return Ok(name)
}
