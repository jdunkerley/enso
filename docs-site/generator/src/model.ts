/**
 * @file The site's pages, from the catalogues: what each entry is (spec, "The generator", step 3),
 * its path (`apiPath`), the GUI's reading of its doc comment, and the indexes the pages link
 * through.
 */
import type { CatalogueEntry, LibraryInput } from './catalogue'
import {
  apiPath,
  documentationData,
  ensoMarkdownParser,
  extractMetadata,
  isConversion as isConversionEntry,
  prerenderMarkdown,
  type ApiPathEntry,
  type DocumentationData,
  type DocumentationMetadata,
  type GroupInfo,
  type QualifiedName,
} from './gui'
import { simpleName } from './typeText'

export type PageKind =
  | 'library'
  | 'module'
  | 'type'
  | 'constructor'
  | 'staticMethod'
  | 'instanceMethod'
  | 'moduleFunction'
  | 'extensionMethod'
export type FunctionKind = Exclude<PageKind, 'library' | 'module' | 'type'>

/** One page of the Components reference. */
export interface Page {
  kind: PageKind
  library: string
  /** The defining module, fully qualified (for a library page, its `Main`). */
  module: string
  /** The page's path under the Components root (`apiPath`): its URL. */
  path: string
  /**
   * The folder of its file under `docs/api/`: `path`, except that a folder whose name differs from
   * an earlier one's only in case becomes `<name>~<n>` (see {@link CaseSafeDirs}). The front
   * matter's `slug` keeps the URL `path`.
   */
  dir: string
  /** The page's `h1`. */
  title: string
  /** The label of the component node; the title's last part for instance methods. */
  nodeName: string
  entry: CatalogueEntry | undefined
  doc: DocumentationData
  metadata: DocumentationMetadata | undefined
}

/** A conversion, listed on its target type's page. */
export interface Conversion {
  target: string
  source: string
  library: string
  doc: DocumentationData
}

export interface SiteModel {
  libraries: string[]
  groups: GroupInfo[]
  pages: Page[]
  byPath: Map<string, Page>
  /** Every documented type's qualified name to its page. */
  types: Map<string, Page>
  /** Conversions by target type. */
  conversions: Map<string, Conversion[]>
  /** Extension methods by self type. */
  extensions: Map<string, Page[]>
  /** Libraries with no catalogue. */
  skipped: string[]
  /** Pairs of paths that differ only in case (Task 13 decides what to do with any). */
  caseCollisions: [string, string][]
}

/**
 * Folders for page paths that stay apart on a case-insensitive file system (Windows, macOS). The
 * reference has pages whose paths differ only in case (a constructor `Name` and a getter `name`, a
 * module `Download` and a function `download`); written as they are, two would share one folder, and
 * a module's pages would land in its namesake's folder. Each folder is decided segment by segment, in
 * the order paths are first seen: the first spelling keeps its name, a later spelling of the same
 * name gets `~1`, `~2`, …, and everything under it follows.
 */
export class CaseSafeDirs {
  private readonly dirs = new Map<string, string>()
  private readonly taken = new Map<string, string>()

  /** The folder for `path` (segments separated by `/`). */
  dirOf(path: string): string {
    const known = this.dirs.get(path)
    if (known != null) return known
    const slash = path.lastIndexOf('/')
    const parent = slash < 0 ? '' : this.dirOf(path.slice(0, slash))
    const base = (parent ? `${parent}/` : '') + path.slice(slash + 1)
    let dir = base
    for (let n = 1; this.taken.has(dir.toLowerCase()); n++) dir = `${base}~${n}`
    this.taken.set(dir.toLowerCase(), path)
    this.dirs.set(path, dir)
    return dir
  }
}

const FUNCTION_KINDS = new Set<PageKind>([
  'constructor',
  'staticMethod',
  'instanceMethod',
  'moduleFunction',
  'extensionMethod',
])

/** Whether a page documents a function (a constructor or a method of any kind). */
export function isFunctionPage(
  page: Page,
): page is Page & { kind: FunctionKind; entry: CatalogueEntry } {
  return FUNCTION_KINDS.has(page.kind) && page.entry != null
}

/** `SuggestionJson.isConversion`: `from`, not static, first argument `that`. */
function isConversion(entry: CatalogueEntry & { type: 'method' }): boolean {
  return isConversionEntry(entry)
}

function metadataOf(documentation: string | undefined): DocumentationMetadata | undefined {
  const text = prerenderMarkdown(documentation ?? '')
  const result = extractMetadata(text, ensoMarkdownParser.parse(text).cursor().node)
  return result.ok ? (result.value ?? undefined) : undefined
}

/**
 * Whether a page is a method on a type of its own library that another module of that library
 * defines (Base's methods on `Any`, for example). Like an extension method (R7), it is listed on
 * its type's page and on its defining module's page, and sits in the sidebar under its defining
 * module, where its URL is.
 */
export function isMethodFromOtherModule(page: Page, model: SiteModel): boolean {
  if (page.kind !== 'staticMethod' && page.kind !== 'instanceMethod') return false
  const selfType = page.entry && 'selfType' in page.entry ? page.entry.selfType : undefined
  const type = selfType ? model.types.get(selfType) : undefined
  return type != null && type.module !== page.module
}

/**
 * The site's pages and indexes from the libraries. Throws when two entries share a path; records
 * paths that differ only in case.
 */
export function buildModel(libraries: LibraryInput[]): SiteModel {
  const groups = libraries.flatMap((library) => library.groups)
  const model: SiteModel = {
    libraries: [],
    groups,
    pages: [],
    byPath: new Map(),
    types: new Map(),
    conversions: new Map(),
    extensions: new Map(),
    skipped: libraries.filter((library) => !library.catalogue).map((library) => library.name),
    caseCollisions: [],
  }
  const lowerCase = new Map<string, string>()
  const dirs = new CaseSafeDirs()

  const add = (fields: Omit<Page, 'dir'>) => {
    const existing = model.byPath.get(fields.path)
    if (existing)
      throw new Error(`Two pages at ${fields.path}: ${existing.title} and ${fields.title}`)
    const folded = lowerCase.get(fields.path.toLowerCase())
    if (folded) model.caseCollisions.push([folded, fields.path])
    else lowerCase.set(fields.path.toLowerCase(), fields.path)
    const page: Page = {
      ...fields,
      dir: dirs.dirOf(fields.path),
    }
    model.byPath.set(page.path, page)
    model.pages.push(page)
    return page
  }
  const docOf = (entry: CatalogueEntry | undefined, library: string) =>
    documentationData(entry?.documentation, library as QualifiedName, groups)

  for (const library of libraries) {
    const catalogue = library.catalogue
    if (!catalogue) continue
    model.libraries.push(library.name)
    const main = catalogue.entries.find(
      (entry) => entry.type === 'module' && entry.module === `${library.name}.Main`,
    )
    add({
      kind: 'library',
      library: library.name,
      module: `${library.name}.Main`,
      path: apiPath({ kind: 'module', module: `${library.name}.Main` }),
      title: library.name,
      nodeName: library.name,
      entry: main,
      doc: docOf(main, library.name),
      metadata: metadataOf(main?.documentation),
    })
    const typeNames = new Set(
      catalogue.entries.flatMap((entry) =>
        entry.type === 'type' ? [`${entry.module}.${entry.name}`] : [],
      ),
    )
    for (const entry of catalogue.entries) {
      const base = {
        library: library.name,
        entry,
        doc: docOf(entry, library.name),
        metadata: metadataOf(entry.documentation),
      }
      switch (entry.type) {
        case 'module':
          if (entry.module === `${library.name}.Main`) break
          add({
            ...base,
            kind: 'module',
            module: entry.module,
            path: apiPath({ kind: 'module', module: entry.module }),
            title: entry.module,
            nodeName: entry.module,
          })
          break
        case 'type': {
          const page = add({
            ...base,
            kind: 'type',
            module: entry.module,
            path: apiPath({
              kind: 'type',
              module: entry.module,
              name: entry.name,
            }),
            title: entry.name,
            nodeName: entry.name,
          })
          model.types.set(`${entry.module}.${entry.name}`, page)
          break
        }
        case 'constructor': {
          const owner = simpleName(entry.returnType)
          const name = `${owner}.${entry.name}`
          add({
            ...base,
            kind: 'constructor',
            module: entry.module,
            path: apiPath({
              kind: 'constructor',
              module: entry.module,
              name: entry.name,
              owner: entry.returnType,
            }),
            title: name,
            nodeName: name,
          })
          break
        }
        case 'method': {
          if (isConversion(entry)) {
            const conversions = model.conversions.get(entry.selfType) ?? []
            conversions.push({
              target: entry.selfType,
              source: entry.arguments[0]!.reprType,
              library: library.name,
              doc: base.doc,
            })
            model.conversions.set(entry.selfType, conversions)
            break
          }
          const pathEntry: ApiPathEntry = {
            kind: 'method',
            module: entry.module,
            name: entry.name,
            owner: entry.selfType,
          }
          const isModuleFunction = entry.selfType === entry.module
          const isExtension = !isModuleFunction && !typeNames.has(entry.selfType)
          const owner = simpleName(entry.selfType)
          const kind: FunctionKind =
            isModuleFunction ? 'moduleFunction'
            : isExtension ? 'extensionMethod'
            : entry.isStatic ? 'staticMethod'
            : 'instanceMethod'
          const page = add({
            ...base,
            kind,
            module: entry.module,
            path: apiPath(pathEntry),
            title: isModuleFunction ? entry.name : `${owner}.${entry.name}`,
            nodeName: isModuleFunction || !entry.isStatic ? entry.name : `${owner}.${entry.name}`,
          })
          if (isExtension) {
            const extensions = model.extensions.get(entry.selfType) ?? []
            extensions.push(page)
            model.extensions.set(entry.selfType, extensions)
          }
          break
        }
        default:
          break
      }
    }
  }
  return model
}
