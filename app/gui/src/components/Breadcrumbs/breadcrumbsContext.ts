/**
 * @file What a `Breadcrumbs.vue` tells each `BreadcrumbItem.vue` in it: whether it is the current
 * (last) one, and what to do when it is pressed or something is dropped on it.
 */
import { createContextStore } from '@/providers'
import { defineComponent, type PropType } from 'vue'

/** A breadcrumb item's key: its `id` prop. */
export type BreadcrumbKey = number | string

/** Handlers shared by all the items of one `Breadcrumbs.vue`. */
export interface BreadcrumbsHandlers {
  readonly onAction?: ((key: BreadcrumbKey) => unknown) | undefined
  readonly onDrop?: ((key: BreadcrumbKey, event: DragEvent) => unknown) | undefined
}

export const [provideBreadcrumbs, injectBreadcrumbs] = createContextStore(
  'Breadcrumbs',
  (handlers: () => BreadcrumbsHandlers) => handlers,
)

export const [provideBreadcrumbIsCurrent, injectBreadcrumbIsCurrent] = createContextStore(
  'BreadcrumbItem current',
  (isCurrent: () => boolean) => isCurrent,
)

/** Tells the item rendered in its default slot whether it is the current one. */
export const BreadcrumbPosition = defineComponent({
  name: 'BreadcrumbPosition',
  props: { isCurrent: { type: Boolean as PropType<boolean>, required: true } },
  setup(props, { slots }) {
    provideBreadcrumbIsCurrent(() => props.isCurrent)
    return () => slots.default?.()
  },
})
