import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { DocumentationData } from '$/providers/openedProjects/suggestionDatabase/documentation'
import type { MethodPointer } from '@/util/methodPointer'
import { standardBaseMainPath, type ProjectPath } from '@/util/projectPath'
import {
  qnJoin,
  qnLastSegment,
  type Identifier,
  type IdentifierOrOperatorIdentifier,
  type QualifiedName,
} from '@/util/qualifiedName'
import { apiPath, isConversion, type ApiPathEntry } from 'enso-common/src/docsSite/apiPath'
import type {
  SuggestionEntryArgument,
  SuggestionEntryScope,
} from 'ydoc-shared/languageServerTypes/suggestions'
export type {
  SuggestionEntryArgument,
  SuggestionEntryScope,
  SuggestionId,
} from 'ydoc-shared/languageServerTypes/suggestions'

/**
 * An alias type for typename (for entry fields like `returnType`).
 *
 * It's not QualifiedName, because it may be a type with parameters, or
 * a type union.
 */
export type Typename = string

// The kind of a suggestion.
export enum SuggestionKind {
  Module = 'Module',
  Type = 'Type',
  Constructor = 'Constructor',
  Method = 'Method',
  Function = 'Function',
  Local = 'Local',
}

export interface SuggestionEntryCommon extends DocumentationData {
  readonly kind: SuggestionKind
  /** A module where the suggested object is defined. */
  definedIn: ProjectPath
  name: IdentifierOrOperatorIdentifier
  /** A type returned by the suggested object. */
  returnType(projectNames: ProjectNameStore): Typename
  /** The fully qualified name of the `SuggestionEntry`, disregarding reexports. */
  definitionPath: ProjectPath
  /**
   * The entry comes from the catalogue of a library the engine has not loaded yet: the language
   * server swaps it for the real one when the library loads.
   */
  fromCatalogue: boolean
}

interface Reexportable {
  /** A least-nested module reexporting this entity. */
  reexportedIn: ProjectPath | undefined
}

interface Scoped {
  /** A scope where this suggestion is visible. */
  scope: SuggestionEntryScope | undefined
}

interface Annotatable {
  /** A list of annotations. They are present for methods and constructors only. */
  annotations: string[]
}

interface TakesArguments {
  /** Argument lists of suggested object (atom or function). */
  arguments: SuggestionEntryArgument[]
}

interface IsMemberOf {
  /** A type or module this method or constructor belongs to. */
  memberOf: ProjectPath
}

export interface ModuleSuggestionEntry extends SuggestionEntryCommon, Reexportable {
  readonly kind: SuggestionKind.Module
}

export interface TypeSuggestionEntry extends SuggestionEntryCommon, Reexportable, TakesArguments {
  readonly kind: SuggestionKind.Type
  /** Qualified name of the parent type. */
  parentType: ProjectPath | undefined
}

/**
 * Determine if a specific suggestion entry represent a "blessed" type that is supposed to be
 * displayed in general type selector drodpowns. Currently this list is effectively hardcoded.
 * We might consider more data-driven selection in the future, but for now this is what was
 * explicitly requested to be present.
 */
export function isUserSelectableType(entry: TypeSuggestionEntry) {
  return (
    !entry.isPrivate &&
    (entry.reexportedIn?.equals(standardBaseMainPath) ?? false) &&
    blessedTypes.has(entry.name)
  )
}

const blessedTypes = new Set([
  'Boolean',
  'Column',
  'Date',
  'Decimal',
  'Dictionary',
  'Float',
  'Integer',
  'Number',
  'Table',
  'Text',
  'Vector',
])

export interface ConstructorSuggestionEntry
  extends SuggestionEntryCommon, Reexportable, Annotatable, TakesArguments, IsMemberOf {
  readonly kind: SuggestionKind.Constructor
}

export interface MethodSuggestionEntry
  extends SuggestionEntryCommon, Reexportable, Annotatable, TakesArguments, IsMemberOf {
  readonly kind: SuggestionKind.Method
  /** Type of the "self" argument. */
  selfType: ProjectPath | undefined
}

export interface FunctionSuggestionEntry extends SuggestionEntryCommon, Scoped, TakesArguments {
  readonly kind: SuggestionKind.Function
}

export interface LocalSuggestionEntry extends SuggestionEntryCommon, Scoped {
  readonly kind: SuggestionKind.Local
}

export type SuggestionEntry =
  | ModuleSuggestionEntry
  | TypeSuggestionEntry
  | ConstructorSuggestionEntry
  | MethodSuggestionEntry
  | FunctionSuggestionEntry
  | LocalSuggestionEntry

/**
 * A type that can be called. This includes every suggestion kind that takes arguments, except
 * {@link SuggestionKind.Type}.
 */
export type CallableSuggestionEntry =
  MethodSuggestionEntry | ConstructorSuggestionEntry | FunctionSuggestionEntry

/** Type predicate for {@link CallableSuggestionEntry}. */
export function entryIsCallable(entry: SuggestionEntry): entry is CallableSuggestionEntry {
  return (
    entry.kind === SuggestionKind.Method ||
    entry.kind === SuggestionKind.Function ||
    entry.kind === SuggestionKind.Constructor
  )
}

/** Predicate for types that can have annotated arguments. */
export function entryIsAnnotatable(
  entry: SuggestionEntry,
): entry is MethodSuggestionEntry | ConstructorSuggestionEntry {
  return entry.kind === SuggestionKind.Method || entry.kind === SuggestionKind.Constructor
}

/** Predicate for members that can be called on a type. */
export function entryIsStatic(
  entry: SuggestionEntry,
): entry is ConstructorSuggestionEntry | (MethodSuggestionEntry & { selfType: undefined }) {
  return (
    entry.kind === SuggestionKind.Constructor ||
    (entry.kind === SuggestionKind.Method && entry.selfType == null)
  )
}

/** Get the MethodPointer pointing to definition represented by the entry. */
export function entryMethodPointer(entry: SuggestionEntry | undefined): MethodPointer | undefined {
  if (entry == null || entry.kind !== SuggestionKind.Method) return
  return {
    module: entry.definedIn,
    definedOnType: entry.memberOf,
    name: entry.name,
  }
}

const mainIdent = 'Main' as Identifier

/** Returns the partial path to use when displaying the name with only the final segment of the parent path. */
export function entryDisplayPath(entry: SuggestionEntry & IsMemberOf): QualifiedName {
  return qnJoin(entryDisplayOwner(entry), entry.name)
}

/** Returns the final segment of the parent path. */
export function entryDisplayOwner(entry: SuggestionEntry & IsMemberOf): QualifiedName {
  const owner = entry.memberOf
  if (owner.path && owner.path !== mainIdent) return qnLastSegment(owner.path)
  if (owner.project) return qnLastSegment(owner.project)
  return mainIdent
}

/** Type predicate for {@link SuggestionEntry} that have the `memberOf` field. */
export function entryHasOwner(entry: SuggestionEntry): entry is SuggestionEntry & IsMemberOf {
  return entry.kind === SuggestionKind.Method || entry.kind === SuggestionKind.Constructor
}

export { isRequiredArgument } from './argument'

/** The fully qualified name of a module or type, spelling the project's own module `Main`. */
function qualifiedPath(path: ProjectPath): string | undefined {
  return path.project && `${path.project}.${path.path ?? 'Main'}`
}

/**
 * The documentation root with exactly one trailing slash, or nothing for an empty or missing
 * setting (`$config.DOCS_URL`), which switches the links off.
 */
export function documentationBase(configured: string | undefined): string | undefined {
  const trimmed = configured?.trim().replace(/\/+$/, '')
  return trimmed ? `${trimmed}/` : undefined
}

/**
 * The documentation site's page for `entry` (`<base>api/<apiPath>/`), or nothing for what the site
 * has no page for: the user's own code, functions and locals, and conversions (listed on their
 * target type's page).
 * @param base The site's documentation root; a missing trailing slash is added.
 */
export function suggestionDocumentationUrl(
  entry: SuggestionEntry,
  base: string,
): string | undefined {
  const root = documentationBase(base)
  if (root == null) return
  try {
    return pageUrl(entry, root)
  } catch {
    // `apiPath` refuses an entry with no usable module or owner: no page, not a broken panel.
    return
  }
}

function pageUrl(entry: SuggestionEntry, root: string): string | undefined {
  if (!entry.definedIn.project?.startsWith('Standard.')) return
  if (
    entry.kind === SuggestionKind.Method &&
    isConversion({ name: entry.name, isStatic: entry.selfType == null, arguments: entry.arguments })
  )
    return
  const module = qualifiedPath(entry.definedIn)
  if (module == null) return
  let pathEntry: ApiPathEntry
  switch (entry.kind) {
    case SuggestionKind.Module:
      pathEntry = { kind: 'module', module }
      break
    case SuggestionKind.Type:
      pathEntry = { kind: 'type', module, name: entry.name }
      break
    case SuggestionKind.Constructor:
      pathEntry = {
        kind: 'constructor',
        module,
        name: entry.name,
        owner: qualifiedPath(entry.memberOf),
      }
      break
    case SuggestionKind.Method:
      pathEntry = {
        kind: 'method',
        module,
        name: entry.name,
        owner: qualifiedPath(entry.memberOf),
      }
      break
    default:
      return
  }
  return `${root}api/${apiPath(pathEntry)}/`
}
