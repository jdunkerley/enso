/**
 * @file The `search_components` and `get_component_docs` MCP tools: look components up in the open
 * project's suggestion database, as the Component Browser does. Pure functions over
 * {@link CatalogueDeps}, which `useProjectMcpTools` builds from the open project's stores at call
 * time.
 */
import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/argument'
import {
  entryIsCallable,
  SuggestionKind,
  type CallableSuggestionEntry,
  type SuggestionEntry,
  type SuggestionId,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import { makeComponentLists } from '@/components/ComponentBrowser/component'
import { Filtering, type SelfArg } from '@/components/ComponentBrowser/filtering'
import { entrySignature } from '@/components/ComponentHelp/signature'
import type { ProjectPath } from '@/util/projectPath'
import { qnJoin, type Identifier, type QualifiedName } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { jsonResult, truncate } from './graphTools'

/** How many matches `search_components` returns when no `limit` is given. */
export const DEFAULT_SEARCH_LIMIT = 20
/** Most characters of a match's summary in `search_components`. */
export const SUMMARY_CHARS = 500
/** Most characters of the documentation in `get_component_docs`. */
export const DOCUMENTATION_CHARS = 20_000

const LOADING_ERROR = 'The component catalogue is still loading. Try again in a moment.'

export interface CatalogueDeps {
  readonly db: SuggestionDb
  /** Whether the initial suggestion database has loaded. */
  readonly loaded: boolean
  readonly projectNames: ProjectNameStore
  /** The libraries the current module imports: on an equal match, their entries come first. */
  readonly importedLibraries: ReadonlySet<QualifiedName>
}

/**
 * The components matching `query`, in the Component Browser's order: without `self_type` the
 * functions called on a module or type; with it, the methods callable on a value of that type.
 * `total` counts the matches before `limit`.
 */
export function searchComponents(
  deps: CatalogueDeps,
  args: { query: string; self_type?: string; limit?: number },
): McpToolResult {
  if (!deps.loaded) return { ok: false, error: LOADING_ERROR }
  let selfArg: SelfArg | undefined
  if (args.self_type != null) {
    const type = findEntry(deps, args.self_type, (entry) => entry.kind === SuggestionKind.Type)
    if (type == null) {
      return {
        ok: false,
        error: `Unknown type ${args.self_type}. Pass a qualified type name, as get_graph prints a node's type.`,
      }
    }
    // As the Component Browser builds it for a source node of this type (`input.ts`).
    const typeInfo = TypeInfo.fromParsedTypes([type.definitionPath], [])!
    selfArg = { type: 'known', typeInfo, ancestors: [...typeInfo.ancestors(deps.db)] }
  }
  const filtering = new Filtering({ pattern: args.query, ...(selfArg ? { selfArg } : {}) })
  const lists = makeComponentLists(deps.db, filtering, deps.importedLibraries)
  // The first list ('all' or 'suggestions') holds every match; the groups' lists repeat them.
  const ids = new Set<SuggestionId>()
  for (const list of lists.values()) {
    for (const { suggestionId } of list) if (suggestionId != null) ids.add(suggestionId)
  }
  const results = []
  for (const id of ids) {
    if (results.length >= (args.limit ?? DEFAULT_SEARCH_LIMIT)) break
    const entry = deps.db.get(id)
    if (entry == null || !entryIsCallable(entry)) continue
    results.push({
      name: printPath(deps, entry.definitionPath),
      signature: signatureLabel(deps, entry),
      summary: truncate(entry.documentationSummary ?? '', SUMMARY_CHARS),
    })
  }
  return jsonResult({ results, total: ids.size })
}

/**
 * One component by the qualified name `search_components` printed: its signature, arguments (but
 * `self`), return type and documentation.
 */
export function getComponentDocs(deps: CatalogueDeps, args: { name: string }): McpToolResult {
  if (!deps.loaded) return { ok: false, error: LOADING_ERROR }
  const entry = findEntry(deps, args.name, entryIsCallable)
  if (entry == null) {
    return {
      ok: false,
      error: `No component named ${args.name}. Use a name returned by search_components.`,
    }
  }
  return jsonResult({
    name: printPath(deps, entry.definitionPath),
    signature: signatureLabel(deps, entry),
    arguments: entry.arguments
      .filter((arg) => arg.name !== 'self')
      .map((arg) => ({
        name: arg.name,
        type: arg.reprType,
        default: arg.defaultValue ?? null,
        // As the signature counts it: a `Missing_Argument` default still has to be replaced.
        optional: arg.hasDefault && !isRequiredArgument(arg),
        values: arg.tagValues ?? undefined,
      })),
    returns: entry.returnType(deps.projectNames),
    documentation: truncate(entry.documentation, DOCUMENTATION_CHARS),
  })
}

function signatureLabel(deps: CatalogueDeps, entry: CallableSuggestionEntry): string {
  return entrySignature(entry, entry.returnType(deps.projectNames)).label
}

/**
 * A definition path as the agent sees it: the project's `Main` module elided, as
 * `printProjectPath` does. (`ProjectPath.normalized` elides only a whole `Main` segment, where
 * `printProjectPath`'s pattern also cuts the start of a `Main_…` module's name.)
 */
function printPath(deps: CatalogueDeps, path: ProjectPath): string {
  return deps.projectNames.serializeProjectPathForBackend(path.normalized())
}

/**
 * The entry `name` names, printed by {@link printPath} or in full. A printed name omits a `Main`
 * module, so when the name itself names no accepted entry, the same path in the project's `Main`
 * module is tried.
 */
function findEntry<T extends SuggestionEntry>(
  deps: CatalogueDeps,
  name: string,
  accept: (entry: SuggestionEntry) => entry is T,
): T | undefined
function findEntry(
  deps: CatalogueDeps,
  name: string,
  accept: (entry: SuggestionEntry) => boolean,
): SuggestionEntry | undefined
function findEntry(
  deps: CatalogueDeps,
  name: string,
  accept: (entry: SuggestionEntry) => boolean,
): SuggestionEntry | undefined {
  const parsed = deps.projectNames.parseProjectPathRaw(name)
  if (!parsed.ok) return undefined
  const path = parsed.value
  const main = 'Main' as Identifier
  const inMain = path.withPath(path.path ? qnJoin(main, path.path) : main)
  for (const candidate of [path, inMain]) {
    const entry = deps.db.getEntryByProjectPath(candidate)
    if (entry != null && accept(entry)) return entry
  }
  return undefined
}
