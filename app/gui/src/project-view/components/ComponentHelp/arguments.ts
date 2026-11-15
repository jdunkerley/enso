import { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/argument'
import type { CallableSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import { argumentDescriptions, splitSections } from '@/components/ComponentHelp/sections'
import type { SuggestionEntryArgument } from 'ydoc-shared/languageServerTypes/suggestions'

/** A qualified name inside a type expression (`Standard.Base.Data.Text.Text`). */
const QUALIFIED_NAME = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g

/** A type expression with each qualified name shortened to its last segment. */
export function unqualifiedType(type: string): string {
  return type.replace(QUALIFIED_NAME, (name) => name.slice(name.lastIndexOf('.') + 1))
}

/** The kind of widget an argument gets on a node, as far as the panel can tell statically. */
export type WidgetKind = 'dropdown' | 'checkbox' | 'number' | 'text' | 'custom' | 'type'

/** One argument of a callable: what the code and the doc say about it. */
export interface DocArgument {
  name: string
  /** Unqualified, `~` before a suspended argument's type. */
  type: string
  /** The engine's rendering of the default, if any. */
  default: string | undefined
  optional: boolean
  widget: WidgetKind
  /** True when no `@` annotation chose the widget: it is what the type gives. */
  widgetInferred: boolean
  /** Markdown from the `## Arguments` bullet; '' when undocumented. */
  description: string
}

/** The label of each {@link WidgetKind}, as the panel shows it. */
export const WIDGET_LABELS: Record<WidgetKind, string> = {
  dropdown: 'dropdown',
  checkbox: 'checkbox',
  number: 'number',
  text: 'text input',
  custom: 'custom widget',
  type: "type's widget",
}

const NUMBER_TYPES = new Set(['Integer', 'Float', 'Number'])

/**
 * The widget an argument gets, as far as the panel can tell without the engine: `@` widgets are
 * built at run time, so an annotated argument is only known to be `custom`.
 */
export function widgetKind(arg: SuggestionEntryArgument, annotated: boolean): WidgetKind {
  if (arg.tagValues?.length) return 'dropdown'
  if (annotated) return 'custom'
  const type = unqualifiedType(arg.reprType)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'Nothing')
  if (type.length !== 1) return 'type'
  if (type[0] === 'Boolean') return 'checkbox'
  if (NUMBER_TYPES.has(type[0]!)) return 'number'
  if (type[0] === 'Text') return 'text'
  return 'type'
}

/** The arguments of a callable but `self`, each with what the code and the doc say about it. */
export function docArguments(entry: CallableSuggestionEntry): DocArgument[] {
  // Only methods and constructors carry annotations.
  const annotations = 'annotations' in entry ? entry.annotations : []
  const args = entry.arguments.filter((arg) => arg.name !== 'self')
  const argumentsSection = splitSections(entry.documentation ?? '').sections.find(
    (s) => s.heading === 'Arguments',
  )
  const { byName } = argumentDescriptions(
    argumentsSection?.text ?? '',
    args.map((arg) => arg.name),
  )
  return args.map((arg) => {
    const annotated = annotations.includes(arg.name)
    return {
      name: arg.name,
      type: (arg.isSuspended ? '~' : '') + unqualifiedType(arg.reprType),
      default: arg.hasDefault && arg.defaultValue != null ? arg.defaultValue : undefined,
      optional: arg.hasDefault && !isRequiredArgument(arg),
      widget: widgetKind(arg, annotated),
      widgetInferred: !annotated,
      description: byName.get(arg.name) ?? '',
    }
  })
}
