/** @file A reactive state object persisted in `localStorage`. */
import { customRef, type Ref } from 'vue'

/** How a {@link PersistedStore} is saved and loaded. */
export interface PersistOptions<State> {
  /** The `localStorage` key. */
  readonly name: string
  /** The version of the saved format. A saved state from another version is passed to `migrate`. */
  readonly version: number
  /**
   * Upgrade a saved state from an older `version`. Without it, a state saved by another version is
   * discarded.
   */
  readonly migrate?: (persistedState: unknown, version: number) => unknown
  /**
   * Combine the saved state (`undefined` when nothing usable is saved) with the initial one. Called
   * on every load, so it may also apply overrides that are not saved. Defaults to a shallow merge.
   */
  readonly merge?: (persistedState: unknown, currentState: State) => State
}

/**
 * A state object saved to `localStorage` on every change, and loaded from it when created.
 *
 * The saved entry is `{ state, version }` as JSON, the format used before #94, so values saved
 * before then still load.
 */
export interface PersistedStore<State extends object> {
  /** The current state. Reactive: replaced as a whole on every change. */
  readonly state: Readonly<Ref<State>>
  /** The current state, read without tracking it in any Vue effect. */
  readonly getState: () => State
  /** Merge `partial` into the state, and save the result. */
  readonly setState: (partial: Partial<State>) => void
  /** Load the state again from `localStorage`. */
  readonly rehydrate: () => void
}

interface SavedEntry {
  readonly state: unknown
  readonly version: unknown
}

function readEntry(name: string): SavedEntry | undefined {
  try {
    const raw = localStorage.getItem(name)
    if (raw == null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null || !('state' in parsed)) return undefined
    return { state: parsed.state, version: 'version' in parsed ? parsed.version : undefined }
  } catch {
    return undefined
  }
}

function writeEntry(name: string, state: unknown, version: number) {
  try {
    localStorage.setItem(name, JSON.stringify({ state, version }))
  } catch {
    // No `localStorage` (or it is full): the state still works, it is just not saved.
  }
}

/** Create a {@link PersistedStore} starting from `initialState()` and the saved state, if any. */
export function createPersistedStore<State extends object>(
  initialState: () => State,
  options: PersistOptions<State>,
): PersistedStore<State> {
  const { name, version } = options
  const merge =
    options.merge ??
    ((persisted: unknown, current: State): State =>
      typeof persisted === 'object' && persisted != null ? { ...current, ...persisted } : current)

  function load(current: State): State {
    const entry = readEntry(name)
    let persisted: unknown = undefined
    let migrated = false
    if (entry != null) {
      if (entry.version === version) {
        persisted = entry.state
      } else if (options.migrate != null) {
        persisted = options.migrate(
          entry.state,
          typeof entry.version === 'number' ? entry.version : 0,
        )
        migrated = true
      }
    }
    const loaded = merge(persisted, current)
    if (migrated) writeEntry(name, loaded, version)
    return loaded
  }

  let currentState = load(initialState())
  const state = customRef<State>((track, trigger) => ({
    get: () => {
      track()
      return currentState
    },
    set: (value) => {
      currentState = value
      trigger()
    },
  }))

  return {
    state,
    getState: () => currentState,
    setState: (partial) => {
      state.value = { ...currentState, ...partial }
      writeEntry(name, currentState, version)
    },
    rehydrate: () => {
      state.value = load(currentState)
    },
  }
}
