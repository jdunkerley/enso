/**
 * @file The dashboard's keyboard and mouse bindings, as the user has rebound them: one instance for
 * the whole app, shared by the React `InputBindingsProvider` and Vue code (the user menu's
 * shortcuts, #83), so that a binding changed in the keyboard-shortcuts settings applies to both at
 * once.
 *
 * The user's bindings are kept in `LocalStorage` under `inputBindings`, as a record from each
 * action to its full list of bindings. Rebinding goes through the instance's `add`, `delete` and
 * `reset`, which save the new list. The binding registry itself is #170's.
 */
import {
  createBindings,
  type DashboardBindingKey,
  type DashboardBindingNamespace,
} from '$/configurations/inputBindings'
import LocalStorage from '$/utils/LocalStorage'
import { createGlobalState } from '@vueuse/core'
import { mapEntries, unsafeEntries } from 'enso-common/src/utilities/data/object'
import { z } from 'zod'

declare module '$/utils/LocalStorage' {
  /** */
  interface LocalStorageData {
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
 * Create the dashboard's bindings with the user's saved bindings applied; changing one saves them
 * all.
 */
export function createDashboardInputBindings(localStorage: LocalStorage) {
  const inputBindingsRaw = createBindings()

  const savedInputBindings = localStorage.get('inputBindings')

  if (savedInputBindings != null) {
    const filteredInputBindings = mapEntries(
      inputBindingsRaw.metadata,
      (k) => savedInputBindings[k],
    )
    for (const [bindingKey, newBindings] of unsafeEntries(filteredInputBindings)) {
      for (const oldBinding of inputBindingsRaw.metadata[bindingKey].bindings) {
        inputBindingsRaw.delete(bindingKey, oldBinding)
      }
      for (const newBinding of newBindings ?? []) {
        inputBindingsRaw.add(bindingKey, newBinding)
      }
    }
  }

  const updateLocalStorage = () => {
    localStorage.set(
      'inputBindings',
      Object.fromEntries(
        Object.entries(inputBindingsRaw.metadata).map((kv) => {
          const [k, v] = kv
          return [k, v.bindings]
        }),
      ),
    )
  }
  return {
    ...inputBindingsRaw,
    reset: (bindingKey: DashboardBindingKey) => {
      inputBindingsRaw.reset(bindingKey)
      updateLocalStorage()
    },
    add: (bindingKey: DashboardBindingKey, binding: string) => {
      inputBindingsRaw.add(bindingKey, binding)
      updateLocalStorage()
    },
    delete: (bindingKey: DashboardBindingKey, binding: string) => {
      inputBindingsRaw.delete(bindingKey, binding)
      updateLocalStorage()
    },
    /** Transparently pass through `metadata`. */
    get metadata() {
      return inputBindingsRaw.metadata
    },
  } satisfies DashboardBindingNamespace
}

/** The dashboard's bindings, with the user's changes: the one instance React and Vue share. */
export const useDashboardInputBindings = createGlobalState(() =>
  createDashboardInputBindings(LocalStorage.getInstance()),
)

/**
 * {@link useDashboardInputBindings}, under a name that React's rules-of-hooks lint accepts outside
 * a component: the instance is a plain object, not a hook.
 */
export const getDashboardInputBindings = useDashboardInputBindings
