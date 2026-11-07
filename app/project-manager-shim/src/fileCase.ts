/**
 * @file The spelling of paths on disk, for file systems that ignore case (Windows, macOS): there a
 * path opens a file whose name may differ from it in case, and writing to it keeps the file's old
 * name. Git, too, sees one file then, under the spelling its index has.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { renameWithRetry } from './localMetadata/jsonFile.js'

/** Whether two names differ only in case. */
function sameIgnoringCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase()
}

/** Reads directories once each; a directory that cannot be read has no entries. */
class DirectoryReader {
  private readonly entries = new Map<string, Promise<readonly string[]>>()

  /** The names in `directory`. */
  read(directory: string): Promise<readonly string[]> {
    let entries = this.entries.get(directory)
    if (entries == null) {
      entries = fs.readdir(directory).catch(() => [])
      this.entries.set(directory, entries)
    }
    return entries
  }
}

/**
 * How each of `relatives` (paths under `root`, with `/`) is spelled on disk, segment by segment:
 * its own spelling where a directory has that name, else that of the one entry there whose name
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
      const entries = await reader.read(directory)
      const name =
        entries.includes(segment) ? segment : (
          entries.find((entry) => sameIgnoringCase(entry, segment))
        )
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

/** Whether `a` and `b` are the same entry on disk. */
async function sameEntry(a: string, b: string): Promise<boolean> {
  const [statA, statB] = await Promise.all([
    fs.lstat(a, { bigint: true }).catch(() => null),
    fs.lstat(b, { bigint: true }).catch(() => null),
  ])
  return statA != null && statB != null && statA.ino === statB.ino && statA.dev === statB.dev
}

/**
 * Rename what `relatives` (paths under `root`, with `/`) open to their spelling, where it differs
 * only in case: a folder or file that a case-insensitive file system kept under its old name.
 * An entry is renamed only when the path's own spelling opens it, so on a file system that
 * respects case nothing is ever renamed.
 */
export async function matchSpelling(root: string, relatives: readonly string[]): Promise<void> {
  for (const relative of relatives) {
    let directory = root
    for (const segment of relative.split('/')) {
      const entries = await fs.readdir(directory).catch(() => null)
      if (entries == null) break
      if (!entries.includes(segment)) {
        const onDisk = entries.find((entry) => sameIgnoringCase(entry, segment))
        if (onDisk == null) break
        const from = path.join(directory, onDisk)
        const to = path.join(directory, segment)
        if (!(await sameEntry(from, to))) break
        await renameWithRetry(from, to)
      }
      directory = path.join(directory, segment)
    }
  }
}
