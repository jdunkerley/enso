import type { GraphStore } from '$/providers/openedProjects/graph'
import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { SuggestionKind } from '$/providers/openedProjects/suggestionDatabase/entry'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { ToValue } from '$/utils/reactivity'
import type { NodeCreation } from '@/composables/nodeCreation'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import type { Vec2 } from '@/util/data/vec2'
import { useToast } from '@/util/toast'
import type { Result } from 'enso-common/src/utilities/data/result'
import { toValue } from 'vue'
import { qualifyAutoscoped, type HasConstructor } from './autoscope'
import { expectedTypesIn } from './expectedTypes'

/** Whether a widget input is an argument that can be popped out (Global Constraints). */
export function canPopOut(input: WidgetInput): boolean {
  return (
    input[ArgumentInfoKey] != null &&
    !WidgetInput.isPlaceholder(input) &&
    input.value instanceof Ast.Ast &&
    !(input.value instanceof Ast.Ident) &&
    !(input.value instanceof Ast.Wildcard)
  )
}

/** The code of the node a popped-out argument becomes, or Err with the unresolved name. */
export function popOutCode(
  arg: Ast.Expression,
  argType: string | undefined,
  graphDb: { getMethodCallInfo(id: Ast.AstId): MethodCallInfo | undefined },
  hasConstructor: HasConstructor,
): Result<string, string> {
  return qualifyAutoscoped(arg, expectedTypesIn(arg, argType, graphDb), hasConstructor)
}

/** The ids of `ast` and all its ancestors, innermost first. */
function ancestorsOf(ast: Ast.Ast): Ast.AstId[] {
  const ids = [ast.id]
  for (let p = ast.parent(); p != null; p = p.parent()) ids.push(p.id)
  return ids
}

/**
 * Move the new node's assignment to just above the body statement that now uses it: Enso
 * bindings are sequential, and new nodes are appended at the end of the body. `ancestors` are
 * the ids from the replaced argument up to the root.
 */
function defineBefore(edit: Ast.MutableModule, ident: Ast.Identifier, ancestors: Ast.AstId[]) {
  for (const id of ancestors) {
    const body = edit.tryGet(id)?.parent()
    if (!(body instanceof Ast.MutableBodyBlock)) continue
    const lines = body.lines
    const newIndex = lines.findIndex((line) => {
      const statement = line.statement?.node
      return statement instanceof Ast.Assignment && statement.pattern.code() === ident
    })
    const userIndex = lines.findIndex((line) => line.statement?.node.id === id)
    if (newIndex < 0 || userIndex < 0) continue
    if (newIndex > userIndex) {
      // The line moves whole, so the node keeps its metadata (the drop position).
      body.updateLines((owned) => {
        const [moved] = owned.splice(newIndex, 1)
        owned.splice(userIndex, 0, moved!)
        return owned
      })
    }
    return
  }
}

/** The pop-out action: `popOut(portId, argName, argType, position)`; shows a toast on failure. */
export function usePopOut(deps: {
  module: ToValue<Pick<ModuleStore, 'ast'>>
  graph: ToValue<Pick<GraphStore, 'db'>>
  suggestionDb: ToValue<SuggestionDb>
  projectNames: Pick<ProjectNameStore, 'parseProjectPathRaw'>
  createNodes: NodeCreation['createNodes']
}) {
  const toast = useToast.error()

  const hasConstructor: HasConstructor = (typeQn, name) => {
    const path = deps.projectNames.parseProjectPathRaw(`${typeQn}.${name}`)
    if (!path.ok) return false
    return (
      toValue(deps.suggestionDb).getEntryByProjectPath(path.value)?.kind ===
      SuggestionKind.Constructor
    )
  }

  function popOut(
    portId: Ast.AstId,
    argName: string,
    argType: string | undefined,
    position: Vec2,
  ): void {
    const port = toValue(deps.module).ast?.tryGet(portId)
    if (!port?.isExpression()) return
    // The value is the expression inside any parentheses; the parentheses go with it.
    let arg: Ast.Expression = port
    while (arg instanceof Ast.Group && arg.expression) arg = arg.expression
    let target: Ast.Expression = arg
    for (let p = target.parent(); p instanceof Ast.Group; p = target.parent()) target = p
    const code = popOutCode(arg, argType, toValue(deps.graph).db, hasConstructor)
    if (!code.ok) {
      toast.show(`Can't pop out: the type of \`${code.error}\` is not known.`)
      return
    }
    deps.createNodes(
      [
        {
          placement: { type: 'fixed', position },
          expression: code.value,
          namePrefix: argName,
        },
      ],
      (edit, [ident]) => {
        if (ident == null) {
          toast.show("Can't pop out: the value could not be made into a node.")
          return
        }
        const mutableTarget = edit.getVersion(target)
        const ancestors = ancestorsOf(mutableTarget)
        mutableTarget.replace(Ast.Ident.new(edit, ident))
        defineBefore(edit, ident, ancestors)
      },
    )
  }

  return { popOut }
}
