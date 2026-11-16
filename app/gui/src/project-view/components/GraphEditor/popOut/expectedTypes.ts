import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import { Ast } from '@/util/ast'
import {
  ArgumentApplication,
  ArgumentAst,
  getMethodCallInfoRecursively,
  interpretCall,
} from '@/util/callTree'
import { ANY_TYPE_QN } from '@/util/ensoTypes'

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
  if (rootType != null) types.set(root.id, rootType)
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
