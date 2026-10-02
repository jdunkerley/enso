/**
 * @file The dashboard's keyboard and mouse bindings (`$/configurations/inputBindings`), one set per
 * window, with the user's changes to them. The React dashboard reads them through its
 * `InputBindingsProvider`; Vue reads them too (the user menu's shortcuts, #83) and the Vue settings
 * page edits them (#86), so all see the same set.
 */
import {
  createBindings,
  type DashboardBindingKey,
  type DashboardBindingNamespace,
} from '$/configurations/inputBindings'
import LocalStorage from '$/utils/LocalStorage'
import { mapEntries, unsafeEntries } from 'enso-common/src/utilities/data/object'
import { shallowRef } from 'vue'
import { z } from 'zod'

declare module '$/utils/LocalStorage' {
  /** */
  interface LocalStorageData {
    /** The bindings of each dashboard action the user has changed, by action. */
    readonly inputBindings: Readonly<Record<string, readonly string[]>>
  }
}

LocalStorage.registerKey('inputBindings', {
  schema: z.record(z.string().array().readonly()).transform((value) =>
    Object.fromEntries(
      Object.entries<unknown>({ ...value }).flatMap((kv) => {
        const [k, v] = kv
        return Array.isArray(v) && v.every((item): item is string => typeof item === 'string') ?
            [[k, v]]
          : []
      }),
    ),
  ),
})

/**
 * The dashboard's bindings, with the user's changes loaded from `localStorage` (`inputBindings`)
 * and saved there on every change. `metadata` is reactive in Vue: a `computed` reading it updates
 * after `add`, `delete` and `reset`.
 */
export function createDashboardInputBindings(
  localStorage: Pick<LocalStorage, 'get' | 'set'> = LocalStorage.getInstance(),
) {
  const inputBindings = createBindings()
  const revision = shallowRef(0)

  const savedInputBindings = localStorage.get('inputBindings')
  if (savedInputBindings != null) {
    const filteredInputBindings = mapEntries(inputBindings.metadata, (k) => savedInputBindings[k])
    for (const [bindingKey, newBindings] of unsafeEntries(filteredInputBindings)) {
      for (const oldBinding of inputBindings.metadata[bindingKey].bindings) {
        inputBindings.delete(bindingKey, oldBinding)
      }
      for (const newBinding of newBindings ?? []) {
        inputBindings.add(bindingKey, newBinding)
      }
    }
  }

  const save = () => {
    localStorage.set(
      'inputBindings',
      Object.fromEntries(Object.entries(inputBindings.metadata).map(([k, v]) => [k, v.bindings])),
    )
    revision.value += 1
  }

  return {
    ...inputBindings,
    reset: (bindingKey: DashboardBindingKey) => {
      inputBindings.reset(bindingKey)
      save()
    },
    add: (bindingKey: DashboardBindingKey, binding: string) => {
      inputBindings.add(bindingKey, binding)
      save()
    },
    delete: (bindingKey: DashboardBindingKey, binding: string) => {
      inputBindings.delete(bindingKey, binding)
      save()
    },
    /** A counter of the changes, for the React provider to re-render its consumers. */
    get revision() {
      return revision.value
    },
    get metadata(): DashboardBindingNamespace['metadata'] {
      // Read for Vue's dependency tracking: `metadata` is a new object after every change.
      void revision.value
      return inputBindings.metadata
    },
  }
}

/** The dashboard's bindings, with the user's changes. */
export type DashboardInputBindings = ReturnType<typeof createDashboardInputBindings>

let instance: DashboardInputBindings | undefined

/** The window's dashboard bindings, created (and the user's changes loaded) on first use. */
export function getDashboardInputBindings(): DashboardInputBindings {
  instance ??= createDashboardInputBindings()
  return instance
}

/**
 * {@link getDashboardInputBindings}, under the name Vue code uses: the instance is a plain object,
 * the same for React and Vue.
 */
export const useDashboardInputBindings = getDashboardInputBindings
