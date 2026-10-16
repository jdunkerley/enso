/**
 * @file The ydoc control channel: a JSON channel on a project's index doc between the GUI and the
 * ydoc server, beside the visualization bridge's `vis:control`. Its one request is `flush`: write
 * the named modules to disk once each contains the edits the GUI had made, so that a version of
 * the project is not taken before the last edit is on disk.
 *
 * The GUI describes its edits by each module doc's state vector and delete set. Both are needed:
 * a deletion (such as `Y.Map.delete`) advances no clock, so a last edit that only deletes is
 * invisible in the state vector. They travel as JSON pairs, not as base64: `lib0`'s base64 picks
 * a Node or a browser implementation, and the polyglot runtime the ydoc server runs in inside the
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

/** The state vector of `doc`. */
export function stateVectorEntries(doc: Y.Doc): StateVectorEntries {
  return [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()]
}

/** Whether `doc` contains every insertion `wanted` describes. */
export function stateVectorCovers(doc: Y.Doc, wanted: StateVectorEntries): boolean {
  const have = Y.decodeStateVector(Y.encodeStateVector(doc))
  return wanted.every(([client, clock]) => (have.get(client) ?? 0) >= clock)
}

/** The deletions `doc` contains. */
export function deleteSetEntries(doc: Y.Doc): DeleteSetEntries {
  const deleteSet = Y.createDeleteSetFromStructStore(doc.store)
  return Object.fromEntries(
    Array.from(deleteSet.clients, ([client, items]) => [
      String(client),
      items.map((item) => [item.clock, item.len] as const),
    ]),
  )
}

/**
 * Whether `doc` contains every deletion `wanted` describes. The ranges of a delete set built from
 * a struct store are maximal runs, so each wanted range must lie inside one of `doc`'s.
 */
export function deleteSetCovers(doc: Y.Doc, wanted: DeleteSetEntries): boolean {
  const have = Y.createDeleteSetFromStructStore(doc.store).clients
  return Object.entries(wanted).every(([client, ranges]) => {
    const items = have.get(Number(client)) ?? []
    return ranges.every(([clock, len]) =>
      items.some((item) => item.clock <= clock && clock + len <= item.clock + item.len),
    )
  })
}

/** What `doc` contains, to send in a `flush`. */
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
