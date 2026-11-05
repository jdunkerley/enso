/**
 * @file The icon of a suggestion entry, from its documentation's `icon:` and its kind. Kept free of
 * the suggestion database and Vue so the docs site's generator applies the same rule.
 */
import type { Icon } from '@/util/iconMetadata/iconName'

/** The icon of an entry whose documentation names none. */
export const DEFAULT_ICON = 'enso_logo' satisfies Icon

/** The icon of an entry; `kind` is a `SuggestionKind` value (`'Module'`, `'Local'`, …). */
export function entryIcon(entry: {
  readonly iconName?: Icon | undefined
  readonly kind: string
}): Icon {
  if (entry.iconName) return entry.iconName
  if (entry.kind === 'Local') return 'local_scope'
  if (entry.kind === 'Module') return 'collection'
  return DEFAULT_ICON
}
