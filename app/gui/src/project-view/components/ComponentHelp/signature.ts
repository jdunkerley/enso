import { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/argument'
import type { CallableSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import { unqualifiedType } from '@/components/ComponentHelp/arguments'

export { unqualifiedType } from '@/components/ComponentHelp/arguments'

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
