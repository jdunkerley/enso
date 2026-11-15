import type { CallableSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  docArguments,
  unqualifiedType,
  type DocArgument,
} from '@/components/ComponentHelp/arguments'

export { unqualifiedType } from '@/components/ComponentHelp/arguments'

/**
 * A function's signature drawn as the documentation site draws it, as a component node: its name
 * and its arguments (but `self`), the optional ones apart.
 */
export interface Signature {
  name: string
  params: DocArgument[]
  /** The unqualified return type. */
  returns: string
  /** The whole signature in text, for screen readers. */
  label: string
}

/** The {@link Signature} of a callable entry, given its return type. */
export function entrySignature(entry: CallableSuggestionEntry, returnType: string): Signature {
  const params = docArguments(entry)
  const returns = unqualifiedType(returnType)
  const detail = (p: DocArgument) => (p.default != null ? `${p.type} = ${p.default}` : p.type)
  return {
    name: entry.name,
    params,
    returns,
    label: `${entry.name}(${params.map((p) => `${p.name}: ${detail(p)}`).join(', ')}) -> ${returns}`,
  }
}
