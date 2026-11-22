/**
 * @file The widget query of a call: `Standard.Base.Metadata.Widget_Query.resolve_call`, attached
 * as a method-pointer visualization to the call's subject. Its arguments are literals, so nothing is
 * compiled in the user's module and the user's module needs no import. What it sends is planned by
 * `widgetQueryPlan.ts` (Note [When A Widget Query Re-Runs]).
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
 * What a query adds after today's seven arguments, each only with a value: the text typed in a
 * searchable argument, the arguments whose type default is a resolver (name to the declared type),
 * and the revision stamp of the declared dependencies' values, which the answer echoes.
 */
export interface WidgetQueryExtras {
  readonly search?: string | undefined
  readonly typeDefaults?: Readonly<Record<string, string>> | undefined
  readonly revision?: string | undefined
}

function hasExtras(extras: WidgetQueryExtras | undefined): extras is WidgetQueryExtras {
  return (
    !!extras?.search ||
    !!extras?.revision ||
    (extras?.typeDefaults != null && Object.keys(extras.typeDefaults).length > 0)
  )
}

/**
 * `resolve_call`'s arguments after the subject: the method's module, type and name, the arguments
 * to resolve, the expression ids of the call's arguments (the resolvers' dependencies), and
 * whether the annotations' subject is the type rather than the visualized value; then, only when
 * any is set, `search`, `type_defaults` and `revision` ({@link WidgetQueryExtras}).
 */
export function resolveCallArguments(
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
  extras?: WidgetQueryExtras,
): string[] {
  const args = [
    Ast.TextLiteral.new(target.module).code(),
    Ast.TextLiteral.new(target.definedOnType).code(),
    Ast.TextLiteral.new(target.name).code(),
    Ast.Vector.build([...argumentNames], Ast.TextLiteral.new).code(),
    Ast.TextLiteral.new(JSON.stringify(uuids)).code(),
    subjectIsType ? 'True' : 'False',
  ]
  if (!hasExtras(extras)) return args
  return [
    ...args,
    Ast.TextLiteral.new(extras.search ?? '').code(),
    Ast.TextLiteral.new(JSON.stringify(extras.typeDefaults ?? {})).code(),
    Ast.TextLiteral.new(extras.revision ?? '').code(),
  ]
}

/** The visualization that asks for the widgets of `argumentNames` of `target`'s call. */
export function widgetQueryConfiguration(
  expressionId: ExternalId,
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
  extras?: WidgetQueryExtras,
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
      extras,
    ),
  }
}
