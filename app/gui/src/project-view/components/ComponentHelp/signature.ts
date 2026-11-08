import { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/argument'
import type { CallableSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'

/** A qualified name inside a type expression (`Standard.Base.Data.Text.Text`). */
const QUALIFIED_NAME = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g

/** A type expression with each qualified name shortened to its last segment. */
export function unqualifiedType(type: string): string {
  return type.replace(QUALIFIED_NAME, (name) => name.slice(name.lastIndexOf('.') + 1))
}

/** One argument of a {@link Signature}. */
export interface SignatureParam {
  name: string
  /** `<type>` or `<type> = <default>`, `~` before the type of a suspended argument. */
  detail: string
  /** It has a default, which the user need not replace. */
  optional: boolean
}

/**
 * A function's signature drawn as the documentation site draws it, as a component node: its name
 * and its arguments (but `self`), the optional ones apart.
 */
export interface Signature {
  name: string
  params: SignatureParam[]
  /** The whole signature in text, for screen readers. */
  label: string
}

/** The {@link Signature} of a callable entry, given its return type. */
export function entrySignature(entry: CallableSuggestionEntry, returnType: string): Signature {
  const params = entry.arguments
    .filter((arg) => arg.name !== 'self')
    .map((arg): SignatureParam => {
      const type = (arg.isSuspended ? '~' : '') + unqualifiedType(arg.reprType)
      return {
        name: arg.name,
        detail: arg.hasDefault && arg.defaultValue != null ? `${type} = ${arg.defaultValue}` : type,
        optional: arg.hasDefault && !isRequiredArgument(arg),
      }
    })
  const returns = unqualifiedType(returnType)
  return {
    name: entry.name,
    params,
    label: `${entry.name}(${params.map((p) => `${p.name}: ${p.detail}`).join(', ')}) -> ${returns}`,
  }
}
