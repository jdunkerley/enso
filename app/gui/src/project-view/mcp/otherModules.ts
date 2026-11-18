/**
 * @file The Write check for the project's other modules. `writeRefusal` over the module in the
 * editor (`Main.enso`) is read live and synchronously; the rest of the project's own modules (every
 * `.enso` file under `src/`, in subfolders too) are only on disk, so they are read and parsed here
 * and checked with the same {@link writeRefusal}. `undo`, `redo` and `refresh` ask before they
 * queue: one of those modules may hold code that enables output, which a refresh would run and an
 * undo could bring back.
 *
 * **Not covered: library code.** Libraries the project imports (`Standard.*`, other libraries under
 * the project's dependencies) are not read: a library function that enables output itself, or
 * `foreign` code, is as unchecked here as it is in `Main.enso`. The files are read at the moment of
 * the call: an edit the user makes to another module between this check and the run is not seen.
 */
import type { ProjectFiles } from '@/stores/projectFiles'
import { Ast } from '@/util/ast'
import type { Path } from 'ydoc-shared/languageServerTypes'
import { writeRefusal } from './writeGuard'

/** The module in the editor, which is checked live and so skipped here. */
const MAIN_MODULE = 'Main.enso'
/** The folder of a project's source modules. */
const SOURCE_FOLDER = 'src'
/** The most entries and the deepest nesting checked; more is refused rather than half-checked. */
const MAX_ENTRIES = 1000
const MAX_DEPTH = 8

/** The answer to `undo`, `redo` and `refresh` when another module of the project enables output. */
export function otherModuleOutputError(module: string): string {
  return `The project's module ${module} has code that can enable output (the same code the edit tools refuse to add), and doing this could run or bring back such code and write. Ask the user to do it themselves.`
}

/** The answer when the project's other modules cannot all be read. */
export function otherModulesUnreadableError(why: string): string {
  return `The project's other modules could not be checked for code that enables output (${why}). Ask the user to do it themselves.`
}

/**
 * Why an agent's `undo`, `redo` or `refresh` is refused because of the project's modules other than
 * `src/Main.enso`: the first module with code that enables output, or modules that cannot be listed
 * or read. `undefined` when every one is clean.
 */
export async function enablesOutputInOtherModules(
  files: Pick<ProjectFiles, 'projectRootId' | 'listDirectory' | 'readFileBinary'>,
): Promise<string | undefined> {
  const rootId = await files.projectRootId
  if (rootId == null) return otherModulesUnreadableError('the project has no file tree')
  let seen = 0
  const visit = async (segments: string[], depth: number): Promise<string | undefined> => {
    const listing = await files.listDirectory({ rootId, segments })
    if (!listing.ok) {
      return otherModulesUnreadableError(`${segments.join('/')}: ${String(listing.error)}`)
    }
    for (const entry of listing.value) {
      if (++seen > MAX_ENTRIES) return otherModulesUnreadableError('too many files')
      const child = [...segments, entry.name]
      if (entry.type === 'Directory' || entry.type === 'DirectoryTruncated') {
        if (depth + 1 > MAX_DEPTH) return otherModulesUnreadableError('folders nested too deep')
        const found = await visit(child, depth + 1)
        if (found != null) return found
      } else if (entry.type === 'File' && /\.enso$/i.test(entry.name)) {
        if (depth === 0 && entry.name === MAIN_MODULE) continue
        const relative = child.slice(1).join('/')
        const path: Path = { rootId, segments: child }
        const blob = await files.readFileBinary(path)
        if (!blob.ok) return otherModulesUnreadableError(`${relative}: ${String(blob.error)}`)
        let refusal: string | undefined
        try {
          refusal = writeRefusal(Ast.parseBlock(await blob.value.text()))
        } catch (e) {
          return otherModulesUnreadableError(`${relative}: ${String(e)}`)
        }
        if (refusal != null) return otherModuleOutputError(relative)
      }
    }
    return undefined
  }
  return visit([SOURCE_FOLDER], 0)
}
