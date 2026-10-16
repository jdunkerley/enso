/** @file Which assets the labels popover may change. */
import type { AssetType, Backend } from 'enso-common/src/services/Backend'

/** The assets among `items` that the backend can label. */
export function labellableItems<T extends { readonly type: AssetType }>(
  backend: Pick<Backend, 'supportsLabels'>,
  items: readonly T[],
): readonly T[] {
  return items.filter((item) => backend.supportsLabels(item.type))
}
