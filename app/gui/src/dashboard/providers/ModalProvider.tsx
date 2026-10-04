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
import { getModalsStore, type Resolution } from '$/providers/modals'
import { reactComponent } from '$/utils/react'
import { isValidElement, type JSX } from 'react'
import type { Component } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'

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

/**
 * Push a React modal on the stack over the open ones, as a react-aria `Dialog.Trigger` opened its
 * dialog without closing others: for a Vue button that opens a React dialog still waiting for its
 * port (the drive's toolbar and labels column, #91, until #198). Unlike a {@link setModal} entry,
 * it leaves the stack once the dialog closes, as the trigger's own dialog went.
 */
export function openReactModal(modal: Modal) {
  const modals = getModalsStore()
  const entry = modals.open(getReactModalEntry(), {
    modal,
    onOpenChange: (isOpen: boolean) => {
      if (!isOpen) entry.close()
    },
  })
  return entry
}

/**
 * Replace every open modal with a Vue modal, as {@link setModal} does with a React one. Unlike a
 * {@link setModal} entry, it leaves the stack once it has closed (it emits `close`).
 */
export function setVueModal<C extends Component>(component: C, props: ComponentProps<C>) {
  const modals = getModalsStore()
  modals.closeAll()
  return modals.open(component, props)
}

/**
 * Replace every open modal with this one, as {@link setModal} does, and ask the user through it:
 * the modal stack's `ask` passes it `onConfirm`/`onCancel`, and its answer resolves the promise.
 * Every modal is closed once it has answered, as the React `ask` always did.
 */
export function askModal(modal: Modal): Promise<Resolution> {
  const modals = getModalsStore()
  modals.closeAll()
  return modals.ask(getReactModalEntry(), { modal }).finally(unsetModal)
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
