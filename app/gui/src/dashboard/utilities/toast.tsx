/**
 * @file The React dashboard's way to show toasts: the subset of `react-toastify`'s `toast` API it
 * uses, forwarding to the app's Vue toast store (`$/providers/toasts`), so that React and Vue share
 * the one `ToastHost.vue`. It goes when the last React caller is ported (#75).
 */
import {
  getToastsStore,
  type ToastChange,
  type ToastContent,
  type ToastId,
  type ToastOptions,
  type ToastType,
} from '$/providers/toasts'
import { reactComponent } from '@/util/react'
import type { ReactNode } from 'react'
import type { Component } from 'vue'

/** A toast's id. */
export type Id = ToastId

/** What a toast shows: a React node, or a function rendering one from the promise's result. */
export type Content = ReactNode | ((props: { readonly data?: unknown }) => ReactNode)

/** The content of one outcome of {@link toast.promise}. */
type PromiseContent = Content | { readonly render: Content }

let reactNodeComponent: Component | undefined

/** Renders a React node inside the Vue toast host; created on first use, to keep imports acyclic. */
function reactNodeContent(node: ReactNode): ToastContent {
  reactNodeComponent ??= reactComponent((props: { readonly node: ReactNode }) => props.node)
  return { component: reactNodeComponent, props: { node } }
}

/** The store's form of a toast's content: text as it is, anything else as a React node. */
function toContent(content: Content, data?: unknown): ToastContent {
  const node = typeof content === 'function' ? content({ data }) : content
  return typeof node === 'string' || typeof node === 'number' ?
      String(node)
    : reactNodeContent(node)
}

/** `toast`, for a given type. */
function show(type: ToastType) {
  return (content: Content, options: Omit<ToastOptions, 'type'> = {}) =>
    getToastsStore().show(toContent(content), { ...options, type })
}

/** Show a toast. Returns its id. */
export function toast(content: Content, options: ToastOptions = {}) {
  return getToastsStore().show(toContent(content), options)
}

toast.success = show('success')
toast.error = show('error')
toast.info = show('info')
toast.warning = show('warning')

/** Show a toast with a spinner, which stays until it is updated or dismissed. */
toast.loading = (content: Content, options: ToastOptions = {}) =>
  getToastsStore().show(toContent(content), {
    isLoading: true,
    autoClose: false,
    closeOnClick: false,
    closeButton: false,
    ...options,
  })

/** Update a toast; `render` replaces its content. */
toast.update = (id: Id, options: ToastOptions & { readonly render?: Content }) => {
  const { render, ...rest } = options
  getToastsStore().update(id, {
    ...rest,
    ...(render !== undefined ? { render: toContent(render) } : {}),
  })
}

/** Close a toast, or every toast. */
toast.dismiss = (id?: Id) => {
  getToastsStore().dismiss(id)
}

/** Listen to toasts being added, updated and removed. Returns the function that unsubscribes. */
toast.onChange = (listener: (change: ToastChange) => void) => getToastsStore().onChange(listener)

/**
 * Show a loading toast while the promise is pending, then turn it into a success or an error
 * toast. Returns the promise.
 */
toast.promise = <T,>(
  promise: Promise<T> | (() => Promise<T>),
  messages: {
    readonly pending?: PromiseContent
    readonly success?: PromiseContent
    readonly error?: PromiseContent
  },
  options: ToastOptions = {},
) => {
  const unwrap = (content: PromiseContent) =>
    typeof content === 'object' && content != null && 'render' in content ? content.render : content
  const id = messages.pending != null ? toast.loading(unwrap(messages.pending), options) : null
  const settle = (
    type: 'error' | 'success',
    content: PromiseContent | undefined,
    data: unknown,
  ) => {
    if (content == null) {
      if (id != null) toast.dismiss(id)
      return
    }
    // `null` returns what the loading toast changed to the defaults.
    const outcome: ToastOptions = {
      ...options,
      type,
      isLoading: null,
      autoClose: null,
      closeOnClick: null,
      closeButton: null,
    }
    const render = toContent(unwrap(content), data)
    if (id != null) getToastsStore().update(id, { ...outcome, render })
    else getToastsStore().show(render, outcome)
  }
  const running = typeof promise === 'function' ? promise() : promise
  running.then(
    (data) => settle('success', messages.success, data),
    (error: unknown) => settle('error', messages.error, error),
  )
  return running
}
