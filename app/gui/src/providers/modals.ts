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

/** How the user answered an {@link ModalsStore.ask | ask}. */
export type Resolution = 'confirm' | 'dismiss'

/**
 * The props {@link ModalsStore.ask | ask} gives the modal: it answers by calling one of them. Each
 * may return a promise, which the modal awaits (the `AlertDialog` shows its confirm button loading
 * meanwhile).
 */
export interface Confirmable {
  readonly onConfirm?: (() => unknown) | undefined
  readonly onCancel?: (() => unknown) | undefined
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
  /** Called when the entry with that key leaves the stack, however it leaves. */
  const onLeave = new Map<number, () => void>()

  /** Run the leave callbacks of the entries that are no longer on the stack. */
  function settleRemoved() {
    if (onLeave.size === 0) return
    const remaining = new Set(stack.value.map((entry) => entry.key))
    for (const [key, callback] of onLeave) {
      if (!remaining.has(key)) {
        onLeave.delete(key)
        callback()
      }
    }
  }

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
    settleRemoved()
  }

  /** Remove every modal. Returns whether there was any. */
  function closeAll() {
    const hadModals = stack.value.length > 0
    if (hadModals) stack.value = []
    settleRemoved()
    return hadModals
  }

  /**
   * Push a modal that asks the user to confirm or cancel, and resolve with the answer: `'confirm'`
   * once its `onConfirm` has been called (and the caller's `onConfirm`, if any, has settled),
   * `'dismiss'` once its `onCancel` has, or if it leaves the stack unanswered (`closeAll`).
   *
   * The modal answers through the {@link Confirmable} props, and stays on the stack until it emits
   * `close`: a Vue `AlertDialog` emits it once its exit animation has ended, so the dialog does not
   * vanish mid-animation. The caller's own `onConfirm`/`onCancel` (say, the deletion itself) run
   * before the promise resolves, so the dialog can show them pending.
   */
  function ask<C extends Component>(component: C, props: ComponentProps<C> & Confirmable) {
    return new Promise<Resolution>((resolve) => {
      let answered = false
      // A callback that throws leaves the question open: the error reaches the modal, which stays,
      // and the user may answer again.
      const answer =
        (resolution: Resolution, callback: (() => unknown) | undefined) => async () => {
          if (answered) return
          await callback?.()
          answered = true
          resolve(resolution)
        }
      const { key } = open(component, {
        ...props,
        onConfirm: answer('confirm', props.onConfirm),
        onCancel: answer('dismiss', props.onCancel),
      })
      onLeave.set(key, () => {
        if (!answered) {
          answered = true
          resolve('dismiss')
        }
      })
    })
  }

  return { stack, open, close, closeAll, ask }
}

/** The app's modal stack, reachable from any code: components, mutation callbacks, the React shim. */
export const useModals = createGlobalState(createModalsStore)

/**
 * {@link useModals} under a name that does not read as a React hook, for code outside Vue's
 * `setup` (the React shim).
 */
export const getModalsStore = useModals
