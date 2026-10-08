/**
 * @file What a `ButtonGroup.vue` tells the `Button.vue`s in it: shared style props, and, for a
 * joined group, where each button sits.
 */
import type { ButtonVariants } from '$/components/Button/variants'
import { createContextStore } from '@/providers'
import { Comment, Fragment, type MaybeRefOrGetter, type VNode } from 'vue'

/** Button props a group can set for all of its buttons. A button's own props win. */
export interface ButtonGroupSharedProps {
  readonly variant?: ButtonVariants['variant'] | undefined
  readonly size?: ButtonVariants['size'] | undefined
  readonly rounded?: ButtonVariants['rounded'] | undefined
  readonly fullWidth?: ButtonVariants['fullWidth'] | undefined
  readonly iconPosition?: ButtonVariants['iconPosition'] | undefined
  readonly showIconOnHover?: ButtonVariants['showIconOnHover'] | undefined
  readonly extraClickZone?: ButtonVariants['extraClickZone'] | undefined
  readonly isActive?: ButtonVariants['isActive'] | undefined
  readonly isDisabled?: boolean | undefined
  readonly isLoading?: boolean | undefined
  readonly loaderPosition?: 'full' | 'icon' | undefined
}

/** Where a button sits in a joined group. */
export type JoinedPosition = 'first' | 'last' | 'middle'

export const [provideButtonGroup, injectButtonGroup] = createContextStore(
  'ButtonGroup',
  (shared: MaybeRefOrGetter<ButtonGroupSharedProps>) => shared,
)

export const [provideJoinedButton, injectJoinedButton] = createContextStore(
  'joined Button',
  (position: MaybeRefOrGetter<JoinedPosition | undefined>) => position,
)

/** The element vnodes of a slot, with fragments (`v-for`, `<template>`) flattened and comments dropped. */
export function flattenSlotChildren(nodes: readonly VNode[]): VNode[] {
  return nodes.flatMap((node) =>
    node.type === Fragment ? flattenSlotChildren(node.children as VNode[])
    : node.type === Comment ? []
    : [node],
  )
}
