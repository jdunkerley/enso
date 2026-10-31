import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  SuggestionKind,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import { Ast } from '@/util/ast'
import {
  astToQualifiedName,
  parseIdents,
  type Identifier,
  type IdentifierOrOperatorIdentifier,
} from '@/util/ast/abstract'
import type { ProjectPath } from '@/util/projectPath'
import {
  normalizeQualifiedName,
  qnLastSegment,
  qnSegments,
  type QualifiedName,
} from '@/util/qualifiedName'

// ========================
// === Imports analysis ===
// ========================

/** Read imports from given module block */
export function* readImports(ast: Ast.BodyBlock): Generator<RawImport> {
  for (const stmt of ast.statements()) {
    if (stmt instanceof Ast.Import) {
      const recognized = recognizeImport(stmt)
      if (recognized) yield recognized
    }
  }
}

/** Parse import statement. */
export function recognizeImport(ast: Ast.Import): RawImport | null {
  const moduleAst = ast.from ?? ast.import_
  const module = moduleAst ? astToQualifiedName(moduleAst) : null
  if (!module) return null
  if (ast.all) {
    const except = (ast.hiding != null ? parseIdents(ast.hiding) : []) ?? []
    return {
      from: module,
      imported: { kind: 'All', except },
    }
  } else if (ast.from && ast.import_) {
    const names = parseIdents(ast.import_) ?? []
    return {
      from: module,
      imported: { kind: 'List', names },
    }
  } else if (ast.import_) {
    const alias = ast.as instanceof Ast.Ident ? ast.as.code() : null
    return {
      from: module,
      imported: alias ? { kind: 'Module', alias } : { kind: 'Module' },
    }
  } else {
    console.error('Unrecognized import', ast.code())
    return null
  }
}

/** Read the imports and transform their literal project paths to logical project paths. */
export function* analyzeImports(
  ast: Ast.BodyBlock,
  projectNames: ProjectNameStore,
): Generator<AbstractImport> {
  for (const { from, imported } of readImports(ast)) {
    const parsed = projectNames.parseProjectPath(normalizeQualifiedName(from))
    if (parsed.ok) {
      yield {
        from: parsed.value,
        imported,
      }
    }
  }
}

/** Information about parsed import statement. */
export interface Import<ModulePath = QualifiedName> {
  from: ModulePath
  imported: ImportedNames
}

export type RawImport = Import<QualifiedName>
export type AbstractImport = Import<ProjectPath>

export type ImportedNames = Module | List | All

/** import Module.Path (as Alias)? */
export interface Module {
  kind: 'Module'
  alias?: Identifier
}

/** from Module.Path import (Ident),+ */
export interface List {
  kind: 'List'
  names: Identifier[]
}

/** from Module.Path import all (hiding (Ident),*)? */
export interface All {
  kind: 'All'
  except: Identifier[]
}

// ========================
// === Required imports ===
// ========================

/** Import required for the suggestion entry. */
export type RequiredImport = QualifiedImport | UnqualifiedImport

/** import Module.Path */
export interface QualifiedImport {
  kind: 'Qualified'
  module: ProjectPath
}

/** from Module.Path import SomeIdentifier */
export interface UnqualifiedImport {
  kind: 'Unqualified'
  from: ProjectPath
  import: Identifier
}

/** Insert the given imports into the given block at an appropriate location. */
export function addImports(
  scope: Ast.MutableBodyBlock,
  importsToAdd: RequiredImport[],
  projectNames: ProjectNameStore,
) {
  const imports = importsToAdd.map((info) => requiredImportToAst(info, projectNames, scope.module))
  const position = newImportsLocation(scope)
  scope.insert(position, ...imports)
}

/**
 * Create a non user-facing string representation of a required import.
 * Meant for key generation and debugging, does not generate a valid code representation.
 */
export function printRequiredImport(i: RequiredImport): string {
  if (i.kind === 'Qualified') return `${i.kind}:${i.module}`
  return `${i.kind}:${i.from}(${i.import})`
}

/**
 * Return a suitable location in the given block to insert an import statement.
 *
 *  The location chosen will be before the first non-import line, and after all preexisting imports.
 *  If there are any blank lines in that range, it will be before them.
 */
function newImportsLocation(scope: Ast.BodyBlock): number {
  let lastImport
  const lines = scope.lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.statement) {
      if (line.statement.node instanceof Ast.Import) {
        lastImport = i
      } else {
        break
      }
    }
  }
  return lastImport === undefined ? 0 : lastImport + 1
}

/**
 * Create an AST representing the required import statement.
 * @internal
 */
export function requiredImportToAst(
  value: RequiredImport,
  projectNames: ProjectNameStore,
  module?: Ast.MutableModule,
) {
  const module_ = module ?? Ast.MutableModule.Transient()
  switch (value.kind) {
    case 'Qualified':
      return Ast.Import.Qualified(qnSegments(projectNames.printProjectPath(value.module)), module_)!
    case 'Unqualified':
      return Ast.Import.Unqualified(
        qnSegments(projectNames.printProjectPath(value.from)),
        value.import,
        module_,
      )!
  }
}

/** A list of required imports for a specific suggestion entry. */
export function requiredImports(
  db: SuggestionDb,
  entry: SuggestionEntry,
  directConImport: boolean = false,
): RequiredImport[] {
  const unqualifiedImport = (from: ProjectPath): UnqualifiedImport[] => [
    {
      kind: 'Unqualified',
      from: from.normalized(),
      import: entry.name as Identifier,
    },
  ]
  switch (entry.kind) {
    case SuggestionKind.Module:
      return entry.reexportedIn ?
          unqualifiedImport(entry.reexportedIn)
        : [
            {
              kind: 'Qualified',
              module: entry.definedIn.normalized(),
            },
          ]
    case SuggestionKind.Type:
      return unqualifiedImport(entry.reexportedIn ?? entry.definedIn)
    case SuggestionKind.Constructor:
      if (directConImport) {
        return unqualifiedImport(entry.reexportedIn ?? entry.memberOf)
      } else {
        const selfType = selfTypeEntry(db, entry)
        return selfType ? requiredImports(db, selfType) : []
      }
    case SuggestionKind.Method: {
      const isStatic = entry.selfType == null
      const selfType = selfTypeEntry(db, entry)
      const isExtension = selfType && !selfType.definedIn.equals(entry.definedIn)
      const definedIn = definedInEntry(db, entry)
      const extensionImports = isExtension && definedIn ? requiredImports(db, definedIn) : []
      const selfTypeImports = isStatic && selfType ? requiredImports(db, selfType) : []
      if (isStatic) {
        return [...extensionImports, ...selfTypeImports]
      } else {
        return [...extensionImports]
      }
    }
    case SuggestionKind.Function:
    case SuggestionKind.Local:
    default:
      return []
  }
}

/** TODO: Add docs */
export function requiredImportsByProjectPath(
  db: SuggestionDb,
  projectPath: ProjectPath,
  directConImport: boolean = false,
) {
  const entry = db.getEntryByProjectPath(projectPath)
  return entry ? requiredImports(db, entry, directConImport) : []
}

function selfTypeEntry(db: SuggestionDb, entry: SuggestionEntry): SuggestionEntry | undefined {
  if (
    (entry.kind === SuggestionKind.Method || entry.kind === SuggestionKind.Constructor) &&
    entry.memberOf
  ) {
    return db.getEntryByProjectPath(entry.memberOf)
  }
}

function definedInEntry(db: SuggestionDb, entry: SuggestionEntry): SuggestionEntry | undefined {
  return db.getEntryByProjectPath(entry.definedIn)
}

/** The project path of the entry that a required import brings in. */
export function entryPathFromRequiredImport(importStatement: RequiredImport): ProjectPath {
  return importStatement.kind === 'Qualified' ?
      importStatement.module
    : importStatement.from.append(importStatement.import)
}

/** TODO: Add docs */
export function requiredImportEquals(left: RequiredImport, right: RequiredImport): boolean {
  if (left.kind != right.kind) return false
  switch (left.kind) {
    case 'Qualified':
      return left.module.equals((right as QualifiedImport).module)
    case 'Unqualified':
      return (
        left.from.equals((right as UnqualifiedImport).from) &&
        left.import === (right as UnqualifiedImport).import
      )
  }
}

/** Check if `existing` import statement covers `required`. */
export function covers(existing: AbstractImport, required: RequiredImport): boolean {
  if (required.kind === 'Qualified') {
    if (existing.imported.kind === 'Module' && existing.from.equals(required.module)) return true
    const parentAndName = required.module.splitAtName()
    if (!parentAndName) return false
    const [parent, name] = parentAndName
    return coversUnqualified(existing, parent, name)
  } else {
    return coversUnqualified(existing, required.from, required.import)
  }
}

function coversUnqualified(
  existing: AbstractImport,
  parent: ProjectPath,
  name: IdentifierOrOperatorIdentifier,
) {
  const importedInList =
    existing.imported.kind === 'List' &&
    existing.from.equals(parent) &&
    existing.imported.names.includes(name as Identifier)
  const importedWithAll =
    existing.imported.kind === 'All' &&
    existing.from.equals(parent) &&
    !existing.imported.except.includes(name as Identifier)
  return importedInList || importedWithAll
}

/** TODO: Add docs */
export function filterOutRedundantImports(
  existing: AbstractImport[],
  required: RequiredImport[],
): RequiredImport[] {
  return required.filter((info) => !existing.some((existing) => covers(existing, info)))
}

// =======================
// === Missing imports ===
// =======================

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/

/**
 * The imports that the type names used in `scope` need and the module lacks (the design is
 * `docs/superpowers/specs/2026-10-30-postgres-sqlite-libraries-design.md`, section 3 and its
 * Amendments 1 and 6).
 *
 * A name counts when it is capitalised and starts an expression or a qualified access (`Postgres`
 * in `Postgres.Server 'h' 5432`). It is skipped when the module binds it (an assignment, a
 * function, a name an import brings in), when an existing import covers it, and when it is
 * autoscoped (`..Server`). Otherwise it is looked up among the suggestion database's types: one
 * match gives that entry's {@link requiredImports}; a type of the current project, or several
 * matches, give nothing. With no match, `libraryPublicTypes` (the types the installed libraries
 * declare) gives the import when exactly one library declares the name.
 * @param moduleRoot - The module's top-level block, for its bindings.
 * @param scope - The part of the module to look at, such as a node's expression.
 */
export function missingImports(
  moduleRoot: Ast.BodyBlock,
  db: SuggestionDb,
  existingImports: readonly AbstractImport[],
  scope: Ast.Ast = moduleRoot,
  libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]> = new Map(),
): RequiredImport[] {
  const bound = boundNames(moduleRoot, existingImports)
  const result: RequiredImport[] = []
  for (const name of new Set(referencedTypeNames(scope))) {
    if (bound.has(name)) continue
    for (const required of importsForTypeName(db, name, libraryPublicTypes)) {
      const covered = existingImports.some((existing) => covers(existing, required))
      if (!covered && !result.some((r) => requiredImportEquals(r, required))) result.push(required)
    }
  }
  return result
}

/** Capitalised names that start an expression or a qualified access, as `Ast.visitRecursive` finds them. */
function referencedTypeNames(scope: Ast.Ast): string[] {
  const names: string[] = []
  Ast.visitRecursive(scope, (ast) => {
    if (ast instanceof Ast.Import || ast instanceof Ast.AutoscopedIdentifier) return false
    if (ast instanceof Ast.PropertyAccess) return ast.lhs ? [ast.lhs] : false
    if (ast instanceof Ast.Ident && TYPE_NAME.test(ast.code())) names.push(ast.code())
    return true
  })
  return names
}

/** Names the module binds: assignments, functions, and what its imports bring in by name. */
function boundNames(moduleRoot: Ast.BodyBlock, existingImports: readonly AbstractImport[]) {
  const bound = new Set<string>()
  for (const { from, imported } of existingImports) {
    if (imported.kind === 'Module') {
      const name =
        imported.alias ??
        (from.path ? qnLastSegment(from.path)
        : from.project ? qnLastSegment(from.project)
        : undefined)
      if (name) bound.add(name)
    } else if (imported.kind === 'List') {
      for (const name of imported.names) bound.add(name)
    }
  }
  Ast.visitRecursive(moduleRoot, (ast) => {
    const definedType = definedTypeName(ast)
    if (definedType) bound.add(definedType)
    if (ast instanceof Ast.Assignment && ast.pattern instanceof Ast.Ident) {
      bound.add(ast.pattern.code())
    } else if (ast instanceof Ast.FunctionDef && ast.name instanceof Ast.Ident) {
      bound.add(ast.name.code())
    }
    return true
  })
  return bound
}

/**
 * The name of the type that `ast` defines (`type Foo` and its members), if it is such a definition.
 * The AST has no class of its own for it: it is a generic node starting with `type` and the name.
 */
function definedTypeName(ast: Ast.Ast): string | undefined {
  if (!(ast instanceof Ast.Generic)) return undefined
  const [keyword, name] = ast.children()
  if (keyword && Ast.isToken(keyword) && keyword.code() === 'type' && name && Ast.isToken(name)) {
    const code = name.code()
    if (TYPE_NAME.test(code)) return code
  }
  return undefined
}

/** The `imports` that were really added: those not in conflict with an existing import. */
export function importsWithoutConflicts(
  imports: readonly RequiredImport[],
  conflicts: readonly DetectedConflict[],
): RequiredImport[] {
  return imports.filter(
    (imp) => !conflicts.some((c) => c.fullyQualified.equals(entryPathFromRequiredImport(imp))),
  )
}

function importsForTypeName(
  db: SuggestionDb,
  name: string,
  libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]>,
): RequiredImport[] {
  const types: SuggestionEntry[] = []
  for (const id of db.conflictingNames.lookup(name as Identifier)) {
    const entry = db.get(id)
    if (entry?.kind === SuggestionKind.Type) types.push(entry)
  }
  if (types.some((entry) => entry.definedIn.project == null)) return []
  if (types.length === 1) return requiredImports(db, types[0]!)
  if (types.length > 1) return []
  const libraries = libraryPublicTypes.get(name) ?? []
  return libraries.length === 1 ?
      [{ kind: 'Unqualified', from: libraries[0]!, import: name as Identifier }]
    : []
}

/* Information about detected conflict import, and advisory on resolution. */
export interface DetectedConflict {
  /* Always true, for more expressive API usage. */
  detected: boolean
  /* Advisory to replace the following name (qualified name or single ident)… */
  pattern: QualifiedName | Identifier
  /* … with this fully qualified name. */
  fullyQualified: ProjectPath
}

export type ConflictInfo = DetectedConflict | undefined

/** Detect possible name clash when adding `importsForEntry` with `existingImports` present. */
export function detectImportConflicts(
  suggestionDb: SuggestionDb,
  existingImports: AbstractImport[],
  importToCheck: RequiredImport,
): ConflictInfo {
  const entryPath = entryPathFromRequiredImport(importToCheck)
  const entryId = suggestionDb.findByProjectPath(entryPath)
  if (entryId == null) return
  const name =
    entryPath.path ? qnLastSegment(entryPath.path)
    : entryPath.project ? qnLastSegment(entryPath.project)
    : undefined
  if (!name) return
  const conflictingIds = suggestionDb.conflictingNames.lookup(name)

  for (const id of conflictingIds) {
    if (id === entryId) continue
    const e = suggestionDb.get(id)
    const required = e ? requiredImports(suggestionDb, e) : []
    for (const req of required) {
      if (existingImports.some((existing) => covers(existing, req))) {
        return {
          detected: true,
          pattern: name,
          fullyQualified: entryPath,
        }
      }
    }
  }
}
