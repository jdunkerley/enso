import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import { Ast } from '@/util/ast'
import {
  ArgumentApplication,
  ArgumentAst,
  getMethodCallInfoRecursively,
  interpretCall,
} from '@/util/callTree'

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
    const application = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
      suggestion: info.suggestion,
      // The access subject of `a.method ...` is the `self` argument. All other arguments are
      // matched by position or name, ignoring which the engine reports as not yet applied (we only
      // read the arguments present in the code).
      subjectAsSelf: true,
    })
    if (application instanceof ArgumentApplication) {
      for (const app of application.iterApplications()) {
        const arg = app.argument
        if (arg instanceof ArgumentAst && arg.argInfo?.reprType != null)
          types.set(arg.ast.id, arg.argInfo.reprType)
      }
    }
    return true
  })
  return types
}
