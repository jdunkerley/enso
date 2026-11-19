/**
 * @file The widget query of a call: `Standard.Base.Metadata.Widget_Query.resolve_call`, attached
 * as a method-pointer visualization to the call's subject. Its arguments are literals, so nothing is
 * compiled in the user's module and the user's module needs no import.
 */
import type { NodeVisualizationConfiguration } from '$/providers/openedProjects/project/executionContext'
import { Ast } from '@/util/ast'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { RESOLVE_CALL_POINTER, WIDGET_QUERY_MODULE } from './consts'

/** The called method, exactly: its method pointer, with the names the engine uses. */
export interface WidgetQueryTarget {
  readonly module: string
  readonly definedOnType: string
  readonly name: string
}

/**
 * `resolve_call`'s arguments after the subject: the method's module, type and name, the arguments
 * to resolve, the expression ids of the call's arguments (for annotations taking `cache`), and
 * whether the annotations' subject is the type rather than the visualized value.
 */
export function resolveCallArguments(
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
): string[] {
  return [
    Ast.TextLiteral.new(target.module).code(),
    Ast.TextLiteral.new(target.definedOnType).code(),
    Ast.TextLiteral.new(target.name).code(),
    Ast.Vector.build([...argumentNames], Ast.TextLiteral.new).code(),
    Ast.TextLiteral.new(JSON.stringify(uuids)).code(),
    subjectIsType ? 'True' : 'False',
  ]
}

/** The visualization that asks for the widgets of `argumentNames` of `target`'s call. */
export function widgetQueryConfiguration(
  expressionId: ExternalId,
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
): NodeVisualizationConfiguration {
  return {
    expressionId,
    visualizationModule: WIDGET_QUERY_MODULE,
    expression: RESOLVE_CALL_POINTER,
    positionalArgumentsExpressions: resolveCallArguments(
      target,
      argumentNames,
      uuids,
      subjectIsType,
    ),
  }
}
