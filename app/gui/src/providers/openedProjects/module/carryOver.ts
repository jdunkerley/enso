/** @file What a module carries over a replacement of its ydoc server session, and how it is put back. */
import { equalityDeep } from 'lib0/function'
import { type Ast, type MutableAst, type NodeMetadataFields, printWithSpans } from 'ydoc-shared/ast'
import { textChangeToEdits } from 'ydoc-shared/util/data/text'
import type { ExternalId } from 'ydoc-shared/yjsModel'

/**
 * The node metadata a session replacement carries over: what the user set on a node. The cached
 * appearance is left out; it is derived, and the new session computes it again.
 */
export type CarriedNodeMetadata = Pick<
  NodeMetadataFields,
  'position' | 'visualization' | 'colorOverride' | 'displayMode'
>
const CARRIED_METADATA_KEYS = [
  'position',
  'visualization',
  'colorOverride',
  'displayMode',
] as const satisfies readonly (keyof CarriedNodeMetadata)[]

/**
 * An AST that had node metadata when the snapshot was taken. It is found again by its external id,
 * or, when the module's text is the snapshot's own, by where it was printed: the same text parses
 * to the same tree, so the `index`-th AST of `type` printed at `span` is the same AST.
 */
export interface SavedAst {
  readonly span: string
  readonly type: string
  readonly index: number
  readonly externalId: ExternalId
  readonly metadata: CarriedNodeMetadata
}

/**
 * A module as it was when its ydoc server session was replaced. `text` is the module's text then
 * (`T_old`); `ownTexts` are the hashes of the texts the module went through since the last update
 * that came from the server, that update's own text (`B_old`) first: a new session that loads one
 * of them has nothing in the file that this client did not see.
 */
export interface ModuleSnapshot {
  readonly path: string
  readonly text: string
  readonly ownTexts: ReadonlySet<string>
  readonly asts: readonly SavedAst[]
}

/**
 * What to do with a module's snapshot once the new session has loaded the module:
 * - `unchanged`: the new session has the snapshot's text. Only the node metadata is merged.
 * - `restore`: the new session has a text this client had before its last edits (they never
 *   reached the file). The snapshot's text is applied, and its metadata merged.
 * - `conflict`: the file changed by some other route; the user chooses.
 */
export type CarryOverDecision = 'unchanged' | 'restore' | 'conflict'

/**
 * Decide what to do with a snapshot, given the text the new session loaded and a hash function of
 * the kind the snapshot's `ownTexts` were made with.
 */
export function decideCarryOver(
  snapshot: Pick<ModuleSnapshot, 'text' | 'ownTexts'>,
  loaded: string,
  hash: (text: string) => string,
): CarryOverDecision {
  if (loaded === snapshot.text) return 'unchanged'
  if (snapshot.ownTexts.has(hash(loaded))) return 'restore'
  return 'conflict'
}

/** The number of separate text changes between two texts. */
export function countTextChanges(before: string, after: string): number {
  return textChangeToEdits(before, after).length
}

function carriedMetadata(ast: Ast): CarriedNodeMetadata | undefined {
  const metadata: CarriedNodeMetadata = {}
  let any = false
  for (const key of CARRIED_METADATA_KEYS) {
    const value = ast.nodeMetadata.get(key)
    if (value != null) {
      Object.assign(metadata, { [key]: value })
      any = true
    }
  }
  return any ? metadata : undefined
}

interface PrintedAst<T> {
  readonly ast: T
  readonly span: string
  readonly type: string
  readonly index: number
}

function printedAsts<T extends Ast>(root: T): PrintedAst<T>[] {
  const printed = printWithSpans(root)
  const result: PrintedAst<T>[] = []
  for (const [span, asts] of printed.info.nodes) {
    const seen = new Map<string, number>()
    for (const ast of asts) {
      const index = seen.get(ast.typeName) ?? 0
      seen.set(ast.typeName, index + 1)
      // `printWithSpans` reports the ASTs of the tree it printed, so they are `root`'s module's.
      result.push({ ast: ast as T, span, type: ast.typeName, index })
    }
  }
  return result
}

/** The ASTs of a module with node metadata worth carrying over, in the form a snapshot keeps them. */
export function saveAsts(root: Ast): SavedAst[] {
  const saved: SavedAst[] = []
  for (const { ast, span, type, index } of printedAsts(root)) {
    const metadata = carriedMetadata(ast)
    if (metadata == null) continue
    saved.push({ span, type, index, externalId: ast.externalId, metadata })
  }
  return saved
}

/** An AST of the module a snapshot is put back into, as {@link planCarryOver} sees it. */
export interface CarryOverTarget<T> {
  readonly node: T
  readonly span: string
  readonly type: string
  readonly index: number
  readonly externalId: ExternalId
  readonly metadata: CarriedNodeMetadata
}

/** A change to one target AST: the external id it gets back, and the metadata it gets. */
export interface CarryOverChange<T> {
  readonly node: T
  readonly externalId?: ExternalId
  readonly metadata?: CarriedNodeMetadata
}

/**
 * Plan putting saved ASTs back into a module. A saved AST is matched by external id; when the
 * module's text is the snapshot's (`textMatches`), one not found by id is matched by its place in
 * the printed text, and gets its old external id back unless another AST of the module has it
 * (the graph's node ids, and so the selection, are external ids). A matched AST whose carried
 * metadata differs gets the saved metadata; a key the saved AST did not have is removed.
 */
export function planCarryOver<T>(
  saved: readonly SavedAst[],
  targets: readonly CarryOverTarget<T>[],
  textMatches: boolean,
): CarryOverChange<T>[] {
  const byId = new Map(targets.map((target) => [target.externalId, target]))
  const placeKey = (place: { span: string; type: string; index: number }) =>
    `${place.span}|${place.type}|${place.index}`
  const byPlace = new Map(targets.map((target) => [placeKey(target), target]))
  const changes: CarryOverChange<T>[] = []
  for (const entry of saved) {
    let target = byId.get(entry.externalId)
    let externalId: ExternalId | undefined
    if (target == null && textMatches) {
      target = byPlace.get(placeKey(entry))
      if (target != null && !byId.has(entry.externalId)) {
        externalId = entry.externalId
        byId.delete(target.externalId)
        byId.set(entry.externalId, target)
      }
    }
    if (target == null) continue
    const metadataDiffers = !equalityDeep(normalized(target.metadata), normalized(entry.metadata))
    if (externalId == null && !metadataDiffers) continue
    changes.push({
      node: target.node,
      ...(externalId != null ? { externalId } : {}),
      ...(metadataDiffers ? { metadata: entry.metadata } : {}),
    })
  }
  return changes
}

/** The carried metadata with its absent keys left out, so that `undefined` and absent compare equal. */
function normalized(metadata: CarriedNodeMetadata): CarriedNodeMetadata {
  const result: CarriedNodeMetadata = {}
  for (const key of CARRIED_METADATA_KEYS) {
    if (metadata[key] != null) Object.assign(result, { [key]: metadata[key] })
  }
  return result
}

/**
 * Put saved ASTs back into a module being edited (see {@link planCarryOver}).
 * @returns the number of ASTs whose metadata changed (an external id given back is not counted:
 * the user did not change it).
 */
export function applySavedAsts(
  root: MutableAst,
  saved: readonly SavedAst[],
  textMatches: boolean,
): number {
  const targets: CarryOverTarget<MutableAst>[] = printedAsts(root).map((printed) => ({
    node: printed.ast,
    span: printed.span,
    type: printed.type,
    index: printed.index,
    externalId: printed.ast.externalId,
    metadata: carriedMetadata(printed.ast) ?? {},
  }))
  const changes = planCarryOver(saved, targets, textMatches)
  for (const change of changes) {
    if (change.externalId != null) change.node.setExternalId(change.externalId)
    if (change.metadata != null) {
      const metadata: NodeMetadataFields = {}
      for (const key of CARRIED_METADATA_KEYS)
        Object.assign(metadata, { [key]: change.metadata[key] })
      change.node.setNodeMetadata(metadata)
    }
  }
  return changes.filter((change) => change.metadata != null).length
}
