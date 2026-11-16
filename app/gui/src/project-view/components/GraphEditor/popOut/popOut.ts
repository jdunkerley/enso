import type { GraphStore } from '$/providers/openedProjects/graph'
import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import type { ModuleStore } from '$/providers/openedProjects/module'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { SuggestionKind } from '$/providers/openedProjects/suggestionDatabase/entry'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { ToValue } from '$/utils/reactivity'
import type { NodeCreation } from '@/composables/nodeCreation'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import type { Vec2 } from '@/util/data/vec2'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
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

/** The pop-out action: `popOut(portId, argName, argType, position)`; shows a toast on failure. */
export function usePopOut(deps: {
  module: ToValue<Pick<ModuleStore, 'ast'>>
  graph: ToValue<Pick<GraphStore, 'db'>>
  suggestionDb: ToValue<SuggestionDb>
  createNodes: NodeCreation['createNodes']
}) {
  const toast = useToast.error()

  const hasConstructor: HasConstructor = (typeQn, name) => {
    const path = parseAbsoluteProjectPathRaw(`${typeQn}.${name}`)
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
    const arg = toValue(deps.module).ast?.tryGet(portId)
    if (!arg?.isExpression()) return
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
          binding: argName,
        },
      ],
      (edit, [ident]) => {
        if (ident == null) return
        edit.getVersion(arg).replace(Ast.Ident.new(edit, ident))
      },
    )
  }

  return { popOut }
}
