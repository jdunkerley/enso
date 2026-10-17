/**
 * @file The ydoc control channel: a JSON channel on a project's index doc between the GUI and the
 * ydoc server, beside the visualization bridge's `vis:control`. Its one request is `flush`: write
 * the named modules to disk once each contains the edits the GUI had made, so that a version of
 * the project is not taken before the last edit is on disk.
 *
 * The GUI describes the whole of each module doc it has: its full state vector and its full delete
 * set. Both are needed: a deletion (such as `Y.Map.delete`) advances no clock, so a last edit that
 * only deletes is invisible in the state vector. Nothing is filtered to the GUI's "own" edits: a
 * graph edit is made in a fresh `Y.Doc` (a random client ID per edit) and applied by
 * `MutableModule.applyEdit`, which is not a local transaction, so its insertions are under a client
 * ID nothing else names. The ydoc server checks the whole description against its own doc (see
 * {@link moduleStateCovers}). They travel as JSON pairs, not as base64: `lib0`'s base64 picks a
 * Node or a browser implementation, and the polyglot runtime the ydoc server runs in inside the
 * engine is neither.
 */
import * as Y from 'yjs'

export const YDOC_CONTROL_CHANNEL = 'ydoc:control'

/**
 * The whole time the ydoc server may take to answer a `flush`, from receiving it: waiting for the
 * edits, the Language Server's requests and the save. The GUI waits longer (`moduleFlusher.ts`).
 */
export const FLUSH_DEADLINE_MS = 4_000

/** A Yjs state vector as `[clientId, clock]` pairs, so that it travels as JSON. */
export type StateVectorEntries = readonly (readonly [number, number])[]

/** A Yjs delete set as `{ clientId: [[clock, length], …] }`, so that it travels as JSON. */
export type DeleteSetEntries = Readonly<Record<string, readonly (readonly [number, number])[]>>

/** What a module doc contains: its state vector (insertions) and delete set (deletions). */
export interface ModuleState {
  readonly stateVector: StateVectorEntries
  readonly deleteSet: DeleteSetEntries
}

/** A message on {@link YDOC_CONTROL_CHANNEL}. */
export type YdocControlMessage =
  | {
      readonly type: 'flush'
      readonly id: string
      /** Each module doc's guid, with what the GUI's copy contained. */
      readonly modules: Readonly<Record<string, ModuleState>>
    }
  | { readonly type: 'flushed'; readonly id: string; readonly ok: true }
  | { readonly type: 'flushed'; readonly id: string; readonly ok: false; readonly error: string }

/** The whole state vector of `doc`: every client's insertions. */
export function stateVectorEntries(doc: Y.Doc): StateVectorEntries {
  return Array.from(Y.decodeStateVector(Y.encodeStateVector(doc)))
}

/** Whether `doc` contains every insertion `wanted` describes. */
export function stateVectorCovers(doc: Y.Doc, wanted: StateVectorEntries): boolean {
  return wanted.every(([client, clock]) => Y.getState(doc.store, client) >= clock)
}

/** Every deletion `doc` contains, whoever made it, keyed by the deleted item's creator. */
export function deleteSetEntries(doc: Y.Doc): DeleteSetEntries {
  return toEntries(Y.createDeleteSetFromStructStore(doc.store))
}

function toEntries(deleteSet: ReturnType<typeof Y.createDeleteSet>): DeleteSetEntries {
  return Object.fromEntries(
    Array.from(deleteSet.clients, ([client, items]) => [
      String(client),
      items.map((item) => [item.clock, item.len] as const),
    ]),
  )
}

/** Whether every struct of `structs` (one client's, sorted) in `[clock, clock + len)` is deleted. */
function rangeDeleted(
  structs: (Y.Item | Y.GC)[],
  state: number,
  clock: number,
  len: number,
): boolean {
  const end = clock + len
  if (len <= 0) return true
  if (clock < 0 || end > state) return false
  // A binary search for the first struct, then only the structs the range spans.
  for (let index = Y.findIndexSS(structs, clock); index < structs.length; index++) {
    const struct = structs[index]!
    if (struct.id.clock >= end) return true
    if (!struct.deleted) return false
  }
  return true
}

/**
 * Whether `doc` contains every deletion `wanted` describes. Each range is looked up in the struct
 * store by binary search, so a check costs about `log(structs)` per wanted range plus the structs
 * the ranges span: it runs on every update of the module while a flush waits.
 */
export function deleteSetCovers(doc: Y.Doc, wanted: DeleteSetEntries): boolean {
  return Object.entries(wanted).every(([key, ranges]) => {
    const client = Number(key)
    const structs = doc.store.clients.get(client)
    if (structs == null) return ranges.every(([, len]) => len <= 0)
    const state = Y.getState(doc.store, client)
    return ranges.every(([clock, len]) => rangeDeleted(structs, state, clock, len))
  })
}

/** What `doc` contains, to send in a `flush`: its whole state vector and delete set. */
export function moduleState(doc: Y.Doc): ModuleState {
  return { stateVector: stateVectorEntries(doc), deleteSet: deleteSetEntries(doc) }
}

/** Whether `doc` contains everything `wanted` describes: its insertions and its deletions. */
export function moduleStateCovers(doc: Y.Doc, wanted: ModuleState): boolean {
  return stateVectorCovers(doc, wanted.stateVector) && deleteSetCovers(doc, wanted.deleteSet)
}

/** Encode a message for the channel. */
export function encodeControlMessage(message: YdocControlMessage): string {
  return JSON.stringify(message)
}

const isPairs = (value: unknown): value is readonly (readonly [number, number])[] =>
  Array.isArray(value) &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'number',
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

const isModuleState = (value: unknown): value is ModuleState =>
  isRecord(value) &&
  isPairs(value.stateVector) &&
  isRecord(value.deleteSet) &&
  Object.values(value.deleteSet).every(isPairs)

/** Decode a message from the channel; `null` for anything that is not one. */
export function parseControlMessage(raw: string): YdocControlMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string') return null
  if (value.type === 'flush') {
    const modules = value.modules
    if (!isRecord(modules) || !Object.values(modules).every(isModuleState)) return null
    return { type: 'flush', id: value.id, modules: modules as Record<string, ModuleState> }
  }
  if (value.type === 'flushed') {
    if (value.ok === true) return { type: 'flushed', id: value.id, ok: true }
    if (value.ok === false && typeof value.error === 'string')
      return { type: 'flushed', id: value.id, ok: false, error: value.error }
  }
  return null
}
