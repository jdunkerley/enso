/** @file The types the Versions tab's components share. */
import type { S3ObjectVersion, S3ObjectVersionId } from 'enso-common/src/services/Backend'

/** A version of an asset, as the Versions tab shows it. */
export interface Version extends S3ObjectVersion {
  /** The version's number, counting from the oldest. */
  readonly number: number
  /** "Version N". */
  readonly title: string
  /** The version's tags, after "Latest" for the latest version. */
  readonly tags: string[]
}

/** Options for duplicating an asset. */
export interface DuplicateOptions {
  /** Open the duplicate once it exists (projects only). */
  readonly start?: boolean
  readonly versionId?: S3ObjectVersionId
}

/** An empty version comment is no comment. */
export function normalizeVersionComment(comment: string | null | undefined): string | null {
  return !comment ? null : comment
}
