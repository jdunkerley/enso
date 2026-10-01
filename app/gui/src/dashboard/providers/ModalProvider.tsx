/**
 * @file The React dashboard's global modal: `setModal`/`unsetModal`, forwarding to the app's Vue
 * modal stack (`$/providers/modals`), so that React and Vue modals share `ModalHost.vue`.
 *
 * `setModal` keeps its single-slot meaning: it replaces every open modal with the given element,
 * which renders in a {@link ReactModalFrame}. It stays on the stack until the next
 * `setModal`/`unsetModal`, even once the dialog has closed itself. The shim goes when the last
 * React caller is ported (#75).
 */
import { ReactModalFrame } from '#/components/ReactModalFrame'
import { getModalsStore } from '$/providers/modals'
import { reactComponent } from '@/util/react'
import { isValidElement, type JSX } from 'react'
import type { Component } from 'vue'

/** The type of a modal. */
export type Modal = JSX.Element

/**
 * A modal or a function that returns a modal.
 *
 * If a function is provided, it will be called with the previous modal as an argument,
 * and the return value will become the new modal.
 */
export type ModalOrCallback = Modal | ((prevModal: Modal | null) => Modal | null)

let reactModalEntry: Component | undefined

/** The Vue component rendering a {@link ReactModalFrame}; made on first use, so imports stay acyclic. */
function getReactModalEntry() {
  return (reactModalEntry ??= reactComponent(ReactModalFrame))
}

/** The topmost modal, if it was opened by {@link setModal}. */
function topReactModal(): Modal | null {
  const entry = getModalsStore().stack.value.at(-1)
  const modal: unknown = entry?.component === reactModalEntry ? entry?.props.modal : null
  return isValidElement(modal) ? modal : null
}

/** Replace every open modal with this one. */
export function setModal(modal: ModalOrCallback) {
  const next = typeof modal === 'function' ? modal(topReactModal()) : modal
  const modals = getModalsStore()
  modals.closeAll()
  if (next != null) modals.open(getReactModalEntry(), { modal: next })
}

/** Close every open modal. Returns `false` if there was none. */
export function unsetModal() {
  if (!getModalsStore().closeAll()) return false
}

/** A ref to the topmost open modal: `current` is `null` when no modal is open. */
const MODAL_REF: { readonly current: unknown } = {
  /** The topmost open modal's stack entry, React or Vue. */
  get current() {
    return getModalsStore().stack.value.at(-1) ?? null
  },
}

/** Whether a modal is open, as a ref to read when needed. */
export function useModalRef() {
  return { modalRef: MODAL_REF } as const
}
