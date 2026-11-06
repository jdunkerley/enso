/**
 * @file The icon of a suggestion entry, from its documentation's `icon:` and its kind. Kept free of
 * the suggestion database and Vue so the docs site's generator applies the same rule.
 */
import type { Icon } from '@/util/iconMetadata/iconName'

/** The icon of an entry whose documentation names none. */
export const DEFAULT_ICON = 'enso_logo' satisfies Icon

/**
 * The values of `SuggestionKind` (`suggestionDatabase/entry.ts`), spelled out: importing the enum,
 * even as a type, would bring the suggestion database into the docs site's type check. They cannot
 * drift apart: `suggestionEntryToIcon` passes a `SuggestionKind`, which compiles only while every
 * member is one of these, and comparing `kind` with a name not listed here does not compile.
 */
export type SuggestionKindName = 'Module' | 'Type' | 'Constructor' | 'Method' | 'Function' | 'Local'

/** The icon of an entry. */
export function entryIcon(entry: {
  readonly iconName?: Icon | undefined
  readonly kind: SuggestionKindName
}): Icon {
  if (entry.iconName) return entry.iconName
  if (entry.kind === 'Local') return 'local_scope'
  if (entry.kind === 'Module') return 'collection'
  return DEFAULT_ICON
}
