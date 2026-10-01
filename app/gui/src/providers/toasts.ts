/** @file The app's toast queue: the notifications that `ToastHost.vue` shows. */
import { createGlobalState } from '@vueuse/core'
import { markRaw, shallowRef, type Component } from 'vue'

/** Identifies a toast, so that it can be updated or dismissed. */
export type ToastId = string | number

/** The kind of a toast; it sets the icon and the colour of the progress bar. */
export type ToastType = 'default' | 'info' | 'success' | 'warning' | 'error'

/** Where on the screen a toast appears. */
export type ToastPosition = 'top-center' | 'bottom-right'

/** What a toast shows: text, or a component rendered with the given props. */
export type ToastContent =
  string | { readonly component: Component; readonly props?: Readonly<Record<string, unknown>> }

/**
 * Options of a single toast. When showing a toast, an option left out takes its default; when
 * updating one, it keeps its current value, and `null` returns it to the default.
 */
export interface ToastOptions {
  /** Showing a toast whose id is already displayed does nothing; use {@link ToastsStore.update}. */
  readonly toastId?: ToastId | undefined
  readonly type?: ToastType | null | undefined
  /** Milliseconds until the toast closes by itself, or `false` to keep it. 5 s by default. */
  readonly autoClose?: number | false | null | undefined
  /** Shows a spinner in place of the icon, and keeps the toast open. */
  readonly isLoading?: boolean | null | undefined
  /** Whether the toast has a close button. `true` by default. */
  readonly closeButton?: boolean | null | undefined
  /** Whether a click anywhere on the toast closes it. `false` by default. */
  readonly closeOnClick?: boolean | null | undefined
  readonly hideProgressBar?: boolean | null | undefined
  /**
   * A progress between 0 and 1, which the progress bar shows instead of the time left. While it is
   * set the toast does not close by itself; reaching 1 closes it. `indeterminate` shows a full,
   * still bar.
   */
  readonly progress?: number | 'indeterminate' | null | undefined
  readonly position?: ToastPosition | null | undefined
}

/** A toast, as the host renders it. */
export interface Toast {
  readonly id: ToastId
  readonly content: ToastContent
  readonly type: ToastType
  readonly autoClose: number | false
  readonly isLoading: boolean
  readonly closeButton: boolean
  readonly closeOnClick: boolean
  readonly hideProgressBar: boolean
  readonly progress: number | 'indeterminate' | null
  readonly position: ToastPosition
  /** `false` once the toast is dismissed and is playing its exit animation. */
  readonly isIn: boolean
  /** Changes on every update that restarts the auto-close timer. */
  readonly revision: number
}

/** A change to the toasts, as reported to {@link ToastsStore.onChange} listeners. */
export interface ToastChange {
  readonly id: ToastId
  readonly status: 'added' | 'updated' | 'removed'
}

/** The time a toast stays open by default, in milliseconds. */
export const DEFAULT_AUTO_CLOSE_MS = 5000
/** How many toasts are displayed at once; further toasts wait until one has gone. */
export const TOAST_LIMIT = 3

const DEFAULT_POSITION: ToastPosition = 'top-center'

/** The toast store; see {@link useToasts}. */
export type ToastsStore = ReturnType<typeof createToastsStore>

/**
 * Create a toast store. The app uses the single global one ({@link useToasts}); tests create their
 * own.
 */
export function createToastsStore() {
  const toasts = shallowRef<readonly Toast[]>([])
  let queue: { content: ToastContent; options: ToastOptions }[] = []
  const listeners = new Set<(change: ToastChange) => void>()
  let nextId = 1

  function emit(change: ToastChange) {
    for (const listener of listeners) listener(change)
  }

  function makeToast(
    id: ToastId,
    content: ToastContent,
    options: ToastOptions,
    base?: Toast,
  ): Toast {
    /** An option left out keeps its current value; one set to `null` returns to the default. */
    function option<K extends keyof ToastOptions & keyof Toast>(
      key: K,
      fallback: NonNullable<Toast[K]>,
    ): NonNullable<Toast[K]> {
      const value = options[key]
      if (value === null) return fallback
      // Every option shares its type with the `Toast` field of the same name.
      return (value ?? base?.[key] ?? fallback) as NonNullable<Toast[K]>
    }
    const isLoading = option('isLoading', false)
    const autoClose = option('autoClose', DEFAULT_AUTO_CLOSE_MS)
    return {
      id,
      content: typeof content === 'string' ? content : markRaw(content),
      type: option('type', 'default'),
      autoClose:
        isLoading ? false
        : autoClose === false || autoClose > 0 ? autoClose
        : DEFAULT_AUTO_CLOSE_MS,
      isLoading,
      closeButton: option('closeButton', true),
      closeOnClick: option('closeOnClick', false),
      hideProgressBar: option('hideProgressBar', false),
      progress: options.progress !== undefined ? options.progress : (base?.progress ?? null),
      position: option('position', DEFAULT_POSITION),
      isIn: base?.isIn ?? true,
      revision: (base?.revision ?? 0) + 1,
    }
  }

  function find(id: ToastId) {
    return toasts.value.find((toast) => toast.id === id)
  }

  /** Show a toast, or queue it while {@link TOAST_LIMIT} toasts are shown. Returns its id. */
  function show(content: ToastContent, options: ToastOptions = {}): ToastId {
    const id = options.toastId ?? nextId++
    if (find(id) != null) return id
    if (toasts.value.length >= TOAST_LIMIT) {
      queue.push({ content, options: { ...options, toastId: id } })
    } else {
      toasts.value = [...toasts.value, makeToast(id, content, options)]
      emit({ id, status: 'added' })
    }
    return id
  }

  /** Change a displayed toast's content or options. It restarts its auto-close timer. */
  function update(id: ToastId, options: ToastOptions & { readonly render?: ToastContent }) {
    const { render, ...rest } = options
    const queued = queue.find((entry) => entry.options.toastId === id)
    if (queued) {
      if (render !== undefined) queued.content = render
      queued.options = { ...queued.options, ...rest }
      return
    }
    const existing = find(id)
    if (existing == null) return
    toasts.value = toasts.value.map((toast) =>
      toast === existing ? makeToast(id, render ?? existing.content, rest, existing) : toast,
    )
    emit({ id, status: 'updated' })
  }

  /** Start closing a toast, or every toast when no id is given. Queued toasts are dropped. */
  function dismiss(id?: ToastId) {
    if (id != null) queue = queue.filter((entry) => entry.options.toastId !== id)
    if (!toasts.value.some((toast) => toast.isIn && (id == null || toast.id === id))) return
    toasts.value = toasts.value.map((toast) =>
      toast.isIn && (id == null || toast.id === id) ? { ...toast, isIn: false } : toast,
    )
  }

  /** Whether the toast is displayed and not closing. */
  function isActive(id: ToastId) {
    return find(id)?.isIn === true
  }

  /** Drop a closed toast, once its exit animation is over, and show the next queued one. */
  function remove(id: ToastId) {
    if (find(id) == null) return
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
    emit({ id, status: 'removed' })
    const next = queue.shift()
    if (next) show(next.content, next.options)
  }

  /** Listen to toasts being added, updated and removed. Returns the function that unsubscribes. */
  function onChange(listener: (change: ToastChange) => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { toasts, show, update, dismiss, isActive, remove, onChange }
}

/** The app's toasts, reachable from any code: Vue components, stores, and the React shim. */
export const useToasts = createGlobalState(createToastsStore)

/**
 * {@link useToasts} under a name that does not read as a React hook, for code outside Vue's
 * `setup` (the React shim).
 */
export const getToastsStore = useToasts
