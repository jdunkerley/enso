/**
 * @file The ydoc control channel: a JSON channel on a project's index doc between the GUI and the
 * ydoc server, beside the visualization bridge's `vis:control`. Its one request is `flush`: write
 * the named modules to disk once each contains the edits the GUI had made (its state vector), so
 * that a version of the project is not taken before the last edit is on disk.
 *
 * State vectors travel as `[clientId, clock]` pairs in JSON, not as base64: `lib0`'s base64 picks
 * a Node or a browser implementation, and the polyglot runtime the ydoc server runs in inside the
 * engine is neither.
 */
import * as Y from 'yjs'

export const YDOC_CONTROL_CHANNEL = 'ydoc:control'

/** A Yjs state vector as `[clientId, clock]` pairs, so that it travels as JSON. */
export type StateVectorEntries = readonly (readonly [number, number])[]

/** A message on {@link YDOC_CONTROL_CHANNEL}. */
export type YdocControlMessage =
  | {
      readonly type: 'flush'
      readonly id: string
      /** Each module doc's guid, with the state vector the GUI had. */
      readonly modules: Readonly<Record<string, StateVectorEntries>>
    }
  | { readonly type: 'flushed'; readonly id: string; readonly ok: true }
  | { readonly type: 'flushed'; readonly id: string; readonly ok: false; readonly error: string }

/** The state vector of `doc`. */
export function stateVectorEntries(doc: Y.Doc): StateVectorEntries {
  return [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()]
}

/** Whether `doc` contains everything `wanted` describes. */
export function stateVectorCovers(doc: Y.Doc, wanted: StateVectorEntries): boolean {
  const have = Y.decodeStateVector(Y.encodeStateVector(doc))
  return wanted.every(([client, clock]) => (have.get(client) ?? 0) >= clock)
}

/** Encode a message for the channel. */
export function encodeControlMessage(message: YdocControlMessage): string {
  return JSON.stringify(message)
}

const isEntries = (value: unknown): value is StateVectorEntries =>
  Array.isArray(value) &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'number',
  )

/** Decode a message from the channel; `null` for anything that is not one. */
export function parseControlMessage(raw: string): YdocControlMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value == null) return null
  const message = value as Record<string, unknown>
  if (typeof message.id !== 'string') return null
  if (message.type === 'flush') {
    const modules = message.modules
    if (typeof modules !== 'object' || modules == null || Array.isArray(modules)) return null
    if (!Object.values(modules).every(isEntries)) return null
    return { type: 'flush', id: message.id, modules: modules as Record<string, StateVectorEntries> }
  }
  if (message.type === 'flushed') {
    if (message.ok === true) return { type: 'flushed', id: message.id, ok: true }
    if (message.ok === false && typeof message.error === 'string')
      return { type: 'flushed', id: message.id, ok: false, error: message.error }
  }
  return null
}
