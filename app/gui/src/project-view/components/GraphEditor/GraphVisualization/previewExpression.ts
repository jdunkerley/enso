/** @file The component browser's preview: the preprocessor applied to the typed expression, in frame. */
import { Ast } from '@/util/ast'
import { moduleCall } from '@/util/moduleCall'

/** The code evaluated, in the method's frame, to preview `code` with `preprocessor`. */
export function previewExpression(
  preprocessor: {
    readonly visualizationModule: string
    readonly expression: string
    readonly positionalArgumentsExpressions?: readonly string[] | undefined
  },
  code: string,
): string {
  const module = Ast.MutableModule.Transient()
  const args = (preprocessor.positionalArgumentsExpressions ?? []).map((arg) =>
    Ast.parseExpression(arg, module)!,
  )
  const call = moduleCall(module, preprocessor.visualizationModule, preprocessor.expression, args)
  return Ast.OprApp.new(module, call, '<|', Ast.parseExpression(code, module)!).code()
}
