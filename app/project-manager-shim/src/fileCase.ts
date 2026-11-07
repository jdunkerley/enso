/**
 * @file The spelling of paths on disk, for file systems that ignore case (Windows, macOS): there a
 * path opens a file whose name may differ from it in case, and writing to it keeps the file's old
 * name. Git, too, sees one file then, under the spelling its index has.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { renameWithRetry } from './localMetadata/jsonFile.js'

/**
 * A name folded for comparing names that differ only in case. The one folding used here and by
 * local versioning: lower case, which is narrower than some file systems' (no `ß` ~ `SS`), so a
 * name it misses is at worst not matched, never matched to another file.
 */
export function foldCase(name: string): string {
  return name.toLowerCase()
}

/** Reads directories once each, until {@link forget}; a directory that cannot be read is `null`. */
class DirectoryReader {
  private readonly entries = new Map<string, Promise<readonly string[] | null>>()

  /** The names in `directory`. */
  read(directory: string): Promise<readonly string[] | null> {
    let entries = this.entries.get(directory)
    if (entries == null) {
      entries = fs.readdir(directory).catch(() => null)
      this.entries.set(directory, entries)
    }
    return entries
  }

  /** Read `directory` again next time: something in it was renamed. */
  forget(directory: string): void {
    this.entries.delete(directory)
  }
}

/** Whether `a` and `b` are the same entry on disk. */
async function sameEntry(a: string, b: string): Promise<boolean> {
  const [statA, statB] = await Promise.all([
    fs.lstat(a, { bigint: true }).catch(() => null),
    fs.lstat(b, { bigint: true }).catch(() => null),
  ])
  return statA != null && statB != null && statA.ino === statB.ino && statA.dev === statB.dev
}

/**
 * The entry of `entries` (the names in `directory`) that `segment` opens under another case: the
 * one whose name differs from it only in case, or, when several do, the one that `segment` opens
 * (the same entry on disk). `null` when there is none, or it cannot be told.
 */
async function caseVariant(
  directory: string,
  entries: readonly string[],
  segment: string,
): Promise<string | null> {
  const folded = foldCase(segment)
  const candidates = entries.filter((entry) => foldCase(entry) === folded)
  if (candidates.length <= 1) return candidates[0] ?? null
  for (const candidate of candidates) {
    if (await sameEntry(path.join(directory, candidate), path.join(directory, segment)))
      return candidate
  }
  return null
}

/**
 * How each of `relatives` (paths under `root`, with `/`) is spelled on disk, segment by segment:
 * its own spelling where a directory has that name, else that of the entry there whose name
 * differs from it only in case; `null` when neither exists. On a file system that respects case, a
 * path that exists is always spelled as it is.
 */
export async function spellingsOnDisk(
  root: string,
  relatives: readonly string[],
): Promise<Map<string, string | null>> {
  const reader = new DirectoryReader()
  const spellings = new Map<string, string | null>()
  for (const relative of relatives) {
    let directory = root
    const segments: string[] = []
    for (const segment of relative.split('/')) {
      const entries = (await reader.read(directory)) ?? []
      const name =
        entries.includes(segment) ? segment : await caseVariant(directory, entries, segment)
      if (name == null) break
      segments.push(name)
      directory = path.join(directory, name)
    }
    spellings.set(
      relative,
      segments.length === relative.split('/').length ? segments.join('/') : null,
    )
  }
  return spellings
}

/**
 * Rename what `relatives` (paths under `root`, with `/`) open to their spelling, where it differs
 * only in case: a folder or file that a case-insensitive file system kept under its old name.
 * An entry is renamed only when the path's own spelling opens it, so on a file system that
 * respects case nothing is ever renamed. Each directory is read once, and again after a rename in
 * it.
 */
export async function matchSpelling(root: string, relatives: readonly string[]): Promise<void> {
  const reader = new DirectoryReader()
  for (const relative of relatives) {
    let directory = root
    for (const segment of relative.split('/')) {
      const entries = await reader.read(directory)
      if (entries == null) break
      if (!entries.includes(segment)) {
        const onDisk = await caseVariant(directory, entries, segment)
        if (onDisk == null) break
        const from = path.join(directory, onDisk)
        const to = path.join(directory, segment)
        if (!(await sameEntry(from, to))) break
        await renameWithRetry(from, to)
        reader.forget(directory)
      }
      directory = path.join(directory, segment)
    }
  }
}
