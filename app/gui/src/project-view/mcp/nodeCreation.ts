/**
 * @file Creating the nodes of one `add_nodes` call: placed, named and inserted, with the call's
 * import lines, in one module edit. Not `useNodeCreation`: that renames a binding it is given
 * (`c` becomes `c1`), reports the new ids only after the graph updates, and selects and pans to
 * the new nodes. This keeps a free binding as the agent gave it, answers the ids at once, and
 * leaves the selection and the view alone. It builds the nodes with the same helpers
 * (`Ast.Assignment.new`, `insertNodeStatements`, `addDetectedImports`) and places them with the
 * same placement function (`usePlacement`).
 */
import { asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { usePlacement } from '@/components/ComponentBrowser/placement'
import { inferPrefixFromAst, insertNodeStatements } from '@/composables/nodeCreation'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { Identifier } from '@/util/qualifiedName'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import type { ParsedStatement } from './editTools'
import { addImportLines, quote } from './importLines'

export interface McpNodeCreationDeps {
  /** Runs `f` in one module edit, committed only when it returns Ok. */
  readonly editModule: <T>(f: (edit: Ast.MutableModule) => Result<T>) => Result<T>
  /** The method on screen, whose body gets the nodes. */
  readonly methodAst: Result<Ast.FunctionDef>
  /** Adds, in `edit`, the imports that the type names used in `scope` need. */
  readonly addDetectedImports: (edit: Ast.MutableModule, scope: Ast.Ast) => void
  /** A name not used in the method nor in `taken`, from `prefix` (`graph.generateLocallyUniqueIdent`). */
  readonly generateName: (prefix: string | undefined, taken: Set<Identifier>) => Identifier
  /** The areas of the nodes on screen, which the new ones must not overlap. */
  readonly nodeAreas: Iterable<Rect>
  /** The area of the node the new ones go after: `after`, else the method's last node. */
  readonly anchorArea: Rect | undefined
  /** The visible part of the scene, for a graph without nodes. */
  readonly viewport: Rect
}

export interface CreatedNode {
  readonly id: NodeId
  readonly position: Vec2
}

/**
 * Where `count` new nodes go: the first below `anchor` (left-aligned with it), each next one
 * below the one before, every one moved right as far as it takes not to overlap `nodeAreas` or
 * the nodes placed before it. Without an anchor, the first goes where the Component Browser puts
 * a node created with nothing selected (the middle of `viewport`, moved down to a free place).
 */
export function placeNewNodes(
  count: number,
  anchor: Rect | undefined,
  nodeAreas: Iterable<Rect>,
  viewport: Rect,
): Vec2[] {
  const rects = [...nodeAreas]
  const { place } = usePlacement(rects, viewport)
  const positions: Vec2[] = []
  let previous = anchor
  for (let i = 0; i < count; i++) {
    const position = place(previous != null ? [previous] : [])
    // A zero size stands for the default node size, as in `useNodeCreation`.
    const rect = new Rect(position, Vec2.Zero)
    rects.push(rect)
    positions.push(position)
    previous = rect
  }
  return positions
}

/**
 * Adds the import lines the module lacks and one node per statement at the end of the method's
 * body, in one module edit: an Err means nothing was added. A binding is kept as given (the
 * caller has refused a taken one); a bare expression gets a generated name, as the Component
 * Browser names a node. Each node gets the imports its type names need, as a node created in the
 * editor does. Returns the new nodes' ids, in order, with their positions.
 */
export function createMcpNodes(
  deps: McpNodeCreationDeps,
  nodes: readonly ParsedStatement[],
  importLines: readonly string[],
): Result<CreatedNode[]> {
  const { methodAst } = deps
  if (!methodAst.ok) return methodAst
  const positions = placeNewNodes(nodes.length, deps.anchorArea, deps.nodeAreas, deps.viewport)
  const taken = new Set<Identifier>()
  for (const { binding } of nodes) if (binding != null) taken.add(binding as Identifier)
  return deps.editModule((edit) => {
    const imports = addImportLines(edit, importLines)
    if (!imports.ok) return imports
    const statements: Ast.Owned<Ast.MutableStatement>[] = []
    const created: CreatedNode[] = []
    for (const [index, { binding, expression }] of nodes.entries()) {
      const rhs = Ast.parseExpression(expression, edit)
      if (rhs == null) return Err(`\`${quote(expression)}\` is not an expression.`)
      const name =
        (binding as Identifier | undefined) ?? deps.generateName(inferPrefixFromAst(rhs), taken)
      taken.add(name)
      const position = positions[index]!
      rhs.setNodeMetadata({ position: position.xy() })
      const assignment = Ast.Assignment.new(name, rhs, { edit })
      deps.addDetectedImports(edit, assignment)
      statements.push(assignment)
      created.push({ id: asNodeId(rhs.externalId), position })
    }
    insertNodeStatements(edit.getVersion(methodAst.value).bodyAsBlock(), statements)
    return Ok(created)
  })
}
