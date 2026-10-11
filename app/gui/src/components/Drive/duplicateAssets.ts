/**
 * @file Resolving name conflicts when assets are added to a directory (an upload, a paste, an
 * upload to the cloud): the types of a resolution, the suggested new name, and
 * {@link resolveDuplications}, which asks the user through `DuplicateAssetsModal.vue`.
 *
 * Framework-free callers (uploads, and the drive's actions and mutations) reach it here.
 */
import type { Category } from '$/providers/category'
import { getModalsStore } from '$/providers/modals'
import { regexEscape } from '$/utils/data/string'
import type { AssetId, Backend, DirectoryId } from 'enso-common/src/services/Backend'
import DuplicateAssetsModal from './DuplicateAssetsModal.vue'

/** Get a unique name based on sibling names: `title (N)`, one past the highest `N` in use. */
export function getUniqueName(title: string, siblingTitles: readonly string[]) {
  title = title.match(/^.*(?= \((?:copy)? ?\d*\)$)/)?.[0] ?? title
  const regex = new RegExp(`^${regexEscape(title)}(?: \\((?:copy)? ?(\\d+)?\\))?$`)
  let maximum: number | null = null
  for (const siblingTitle of siblingTitles) {
    const [match, number] = siblingTitle.match(regex) ?? []
    if (match == null) continue
    const newMaximum = number == null ? 1 : parseInt(number, 10)
    maximum = Math.max(maximum ?? 0, newMaximum)
  }
  return maximum == null ? title : `${title} (${maximum + 1})`
}

/** The conclusion of a resolved duplication. */
export type Conclusion = 'rename' | 'replace' | 'skip'

/** A resolved duplication. */
export type ResolvedDuplication = RenameDuplication | ReplaceDuplication | SkipDuplication

/** A resolved duplication that was skipped. */
export interface SkipDuplication {
  readonly assetId: AssetId
  readonly conclusion: 'skip'
}

/** A resolved duplication that was renamed. */
export interface RenameDuplication {
  readonly assetId: AssetId
  readonly conclusion: 'rename'
  readonly newName: string
}

/** A resolved duplication that replaces the existing asset. The backend must support that. */
export interface ReplaceDuplication {
  readonly assetId: AssetId
  readonly conclusion: 'replace'
}

/** Options for {@link resolveDuplications}. */
export interface ResolveDuplicationsOptions {
  readonly targetId: DirectoryId
  readonly conflictingIds: readonly AssetId[]
  /** The drive's current category when not given. */
  readonly category?: Category | undefined
  /** The drive's current backend when not given. */
  readonly backend?: Backend | undefined
  /** Whether to offer to replace the existing asset. */
  readonly canReplace?: boolean | undefined
}

/**
 * Ask the user how to resolve name conflicts: skip, replace or rename each asset. Resolves with the
 * choices, or with none when no asset actually conflicts; rejects when the user cancels.
 *
 * It closes every open modal first.
 */
export function resolveDuplications(options: ResolveDuplicationsOptions) {
  const modals = getModalsStore()
  modals.closeAll()
  return new Promise<readonly ResolvedDuplication[]>((resolve, reject) => {
    modals.open(DuplicateAssetsModal, {
      ...options,
      onSubmit: resolve,
      // Rejected with no reason: callers only see that it failed.
      onCancel: () => reject(),
    })
  })
}
