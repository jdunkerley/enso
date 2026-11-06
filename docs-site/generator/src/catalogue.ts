import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGroups } from './groups'
import type { GroupInfo, LsSuggestionEntry } from './gui'

/** The catalogue format this generator reads (`LibraryCatalogue.Format`). */
export const CATALOGUE_FORMAT = 1

/** A catalogue entry: the language server's `SuggestionEntry`, plus the full reexport set. */
export type CatalogueEntry = LsSuggestionEntry & { reexports?: string[] }

/** A library's `catalogue.json` (`LibraryCatalogue.toJson`). */
export interface Catalogue {
  format: 1
  library: string
  version: string
  engineVersion: string
  sourceHash: string
  entries: CatalogueEntry[]
}

/** One library directory: its name, groups and, unless it has none, its catalogue. */
export interface LibraryInput {
  name: string
  dir: string
  groups: GroupInfo[]
  catalogue: Catalogue | undefined
}

/** The fixture libraries, for tests and `generate --fixtures`. */
export const FIXTURES_LIB = fileURLToPath(new URL('../fixtures/lib', import.meta.url))

/** Read a `catalogue.json`; a format this generator does not know fails the run. */
export function readCatalogue(file: string): Catalogue {
  const catalogue = JSON.parse(readFileSync(file, 'utf8')) as Catalogue
  if (catalogue.format !== CATALOGUE_FORMAT) {
    throw new Error(
      `${catalogue.library}: catalogue format ${catalogue.format as number}, expected ${CATALOGUE_FORMAT} (${file})`,
    )
  }
  return catalogue
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory()
const subdirs = (path: string) =>
  readdirSync(path)
    .sort()
    .map((name) => join(path, name))
    .filter(isDir)

/** Every `<root>/<namespace>/<name>/<version>` directory that holds a `package.yaml`. */
export function findLibraryDirs(root: string): string[] {
  return subdirs(root)
    .flatMap(subdirs)
    .flatMap(subdirs)
    .filter((dir) => existsSync(join(dir, 'package.yaml')))
}

/**
 * The libraries under each root, which is a distribution's `lib` directory or one library's own
 * directory. Libraries without a catalogue (`catalogue: false` in `package.yaml`) keep their groups,
 * which other libraries' entries may name, and get no pages.
 */
export function readLibraries(roots: string[]): LibraryInput[] {
  const dirs = roots.flatMap((root) =>
    existsSync(join(root, 'package.yaml')) ? [root] : findLibraryDirs(root),
  )
  return dirs.map((dir) => {
    const { library, groups } = readGroups(readFileSync(join(dir, 'package.yaml'), 'utf8'))
    const file = join(dir, 'catalogue.json')
    return {
      name: library,
      dir,
      groups,
      catalogue: existsSync(file) ? readCatalogue(file) : undefined,
    }
  })
}
