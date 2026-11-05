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
  path: string
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

const FUNCTION_KINDS = new Set<PageKind>([
  'constructor',
  'staticMethod',
  'instanceMethod',
  'moduleFunction',
  'extensionMethod',
])

export function isFunctionPage(
  page: Page,
): page is Page & { kind: FunctionKind; entry: CatalogueEntry } {
  return FUNCTION_KINDS.has(page.kind) && page.entry != null
}

/** `SuggestionJson.isConversion`: `from`, not static, first argument `that`. */
function isConversion(entry: CatalogueEntry & { type: 'method' }): boolean {
  return entry.name === 'from' && !entry.isStatic && entry.arguments[0]?.name === 'that'
}

function metadataOf(documentation: string | undefined): DocumentationMetadata | undefined {
  const text = prerenderMarkdown(documentation ?? '')
  const result = extractMetadata(text, ensoMarkdownParser.parse(text).cursor().node)
  return result.ok ? (result.value ?? undefined) : undefined
}

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

  const add = (page: Page) => {
    const existing = model.byPath.get(page.path)
    if (existing) throw new Error(`Two pages at ${page.path}: ${existing.title} and ${page.title}`)
    const folded = lowerCase.get(page.path.toLowerCase())
    if (folded) model.caseCollisions.push([folded, page.path])
    else lowerCase.set(page.path.toLowerCase(), page.path)
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
