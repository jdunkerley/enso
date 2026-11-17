import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import { SuggestionKind } from '$/providers/openedProjects/suggestionDatabase/entry'
import { Ast } from '@/util/ast'
import {
  ArgumentApplication,
  ArgumentAst,
  getMethodCallInfoRecursively,
  interpretCall,
} from '@/util/callTree'
import { ANY_TYPE_QN } from '@/util/ensoTypes'
import type { ProjectPath } from '@/util/projectPath'

/**
 * The expected type at `root` (`rootType`, the dragged argument's own) and at every argument
 * of every call inside it whose method call info the graph database has, keyed by the
 * argument value's AST id.
 */
export function expectedTypesIn(
  root: Ast.Expression,
  rootType: string | undefined,
  graphDb: { getMethodCallInfo(id: Ast.AstId): MethodCallInfo | undefined },
): Map<Ast.AstId, string> {
  const types = new Map<Ast.AstId, string>()
  // `Any` says nothing: leave the position unknown rather than qualify with `Any`.
  if (rootType != null && rootType !== 'Any' && rootType !== ANY_TYPE_QN)
    types.set(root.id, rootType)
  Ast.visitRecursive(root, (ast) => {
    if (!(ast instanceof Ast.App || ast instanceof Ast.OprApp)) return true
    // Only the top of an application chain: inner links are covered through it.
    const parent = ast.parent()
    if (parent instanceof Ast.App && parent.function.id === ast.id) return true
    const info = getMethodCallInfoRecursively(ast, graphDb)
    if (!info) return true
    const call = interpretCall(ast)
    // As the function widget does: the bare function's info says whether `self` is already
    // applied (by the access subject of `a.method`) or is still the first positional argument
    // (`Type.method a ...`).
    const noArgs = call.kind === 'prefix' ? graphDb.getMethodCallInfo(call.func.id) : undefined
    const application = ArgumentApplication.FromInterpretedWithInfo(call, {
      suggestion: info.suggestion,
      notAppliedArguments: noArgs?.methodCall.notAppliedArguments,
      subjectAsSelf: noArgs ? !noArgs.methodCall.notAppliedArguments.includes(0) : true,
    })
    if (application instanceof ArgumentApplication) {
      for (const app of application.iterApplications()) {
        const arg = app.argument
        if (!(arg instanceof ArgumentAst)) continue
        const type = arg.argInfo?.reprType
        // `Any` says nothing: leave the position unknown rather than qualify with `Any`.
        if (type != null && type !== 'Any' && type !== ANY_TYPE_QN) types.set(arg.ast.id, type)
      }
    }
    return true
  })
  return types
}

/**
 * The type of each auto-scoped constructor inside `root` that the graph database has resolved,
 * keyed by the auto-scoped name's AST id. It is the resolution by which the function widget shows
 * the constructor's own arguments: the method call info of the application the name heads (or of
 * the name alone) names the constructor, and its suggestion entry's `memberOf` is the type. Known
 * even where the argument's declared type is not specific (`Any`).
 */
export function resolvedAutoscopedTypes(
  root: Ast.Expression,
  graphDb: { getMethodCallInfo(id: Ast.AstId): MethodCallInfo | undefined },
): Map<Ast.AstId, ProjectPath> {
  const types = new Map<Ast.AstId, ProjectPath>()
  Ast.visitRecursive(root, (ast) => {
    if (!(ast instanceof Ast.AutoscopedIdentifier)) return true
    // The top of the application chain the name heads (`..Delimited ',' ...`): the info may be
    // reported at any link of it, and `getMethodCallInfoRecursively` walks down from the top.
    let top: Ast.Expression = ast
    for (let p = top.parent(); p instanceof Ast.App && p.function.id === top.id; p = top.parent())
      top = p
    const suggestion = getMethodCallInfoRecursively(top, graphDb)?.suggestion
    if (
      suggestion?.kind === SuggestionKind.Constructor &&
      suggestion.name === ast.identifier.code()
    )
      types.set(ast.id, suggestion.memberOf)
    return true
  })
  return types
}
