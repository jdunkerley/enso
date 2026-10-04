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
import { reactComponent } from '$/utils/react'
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
  const outcome = (content: PromiseContent | undefined) =>
    content == null ? undefined : (data: unknown) => toContent(unwrap(content), data)
  return getToastsStore().promise(
    typeof promise === 'function' ? promise() : promise,
    {
      pending: messages.pending != null ? toContent(unwrap(messages.pending)) : undefined,
      success: outcome(messages.success),
      error: outcome(messages.error),
    },
    options,
  )
}
