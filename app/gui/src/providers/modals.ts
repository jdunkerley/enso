/** @file The app's stack of programmatically opened modals, rendered by `ModalHost.vue`. */
import { createGlobalState } from '@vueuse/core'
import { markRaw, shallowRef, type Component } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'

/** A modal on the stack: a component, and the props to render it with. */
export interface ModalEntry {
  readonly key: number
  readonly component: Component
  readonly props: Readonly<Record<string, unknown>>
}

/** The modal store; see {@link useModals}. */
export type ModalsStore = ReturnType<typeof createModalsStore>

/**
 * Create a modal stack. The app uses the single global one ({@link useModals}); tests create their
 * own.
 *
 * It is a stack rather than a single slot, so that a confirmation can open over a dialog without
 * replacing it. Each modal renders its own overlay (a `Dialog`, which portals into
 * `#enso-portal-root`); the stack only decides which modals exist, in which order.
 */
export function createModalsStore() {
  const stack = shallowRef<readonly ModalEntry[]>([])
  let nextKey = 1

  /**
   * Push a modal. It stays until {@link close}d: the host closes it when the component emits
   * `close`.
   */
  function open<C extends Component>(component: C, props: ComponentProps<C>) {
    const key = nextKey++
    // Props are passed through untouched: they may hold values of another framework (the React
    // shim's elements), which must not become reactive proxies.
    stack.value = [...stack.value, { key, component: markRaw(component), props: markRaw(props) }]
    return { key, close: () => close(key) }
  }

  /** Remove a modal, or the topmost one when no key is given. */
  function close(key?: number) {
    stack.value =
      key == null ? stack.value.slice(0, -1) : stack.value.filter((entry) => entry.key !== key)
  }

  /** Remove every modal. Returns whether there was any. */
  function closeAll() {
    const hadModals = stack.value.length > 0
    if (hadModals) stack.value = []
    return hadModals
  }

  return { stack, open, close, closeAll }
}

/** The app's modal stack, reachable from any code: components, mutation callbacks, the React shim. */
export const useModals = createGlobalState(createModalsStore)

/**
 * {@link useModals} under a name that does not read as a React hook, for code outside Vue's
 * `setup` (the React shim).
 */
export const getModalsStore = useModals
