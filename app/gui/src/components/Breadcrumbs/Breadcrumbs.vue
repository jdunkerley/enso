<script setup lang="ts">
/**
 * @file A breadcrumb trail: the Vue counterpart of the React `#/components/Breadcrumbs`, styled by
 * the same `BREADCRUMBS_STYLES`.
 *
 * The items are `BreadcrumbItem.vue`s in the default slot; the last one is the current page
 * (`aria-current="page"`, not pressable). `@action` receives the `id` of a pressed item, and
 * `@drop` the `id` of the item something was dropped on, with the drop event. Items are icon
 * buttons, as React's `Button.GroupProvider variant="icon"` makes them.
 *
 * `getItemsWithCollapsedItem` (`./utilities`) collapses a long trail into a "more" item.
 */
import { provideButtonGroup } from '$/components/Button/buttonGroup'
import { flattenSlotChildren } from '$/components/Button/buttonGroup'
import { BREADCRUMBS_STYLES } from '$/components/Breadcrumbs/variants'
import Icon from '$/components/Icon/Icon.vue'
import { useSlots, type VNode } from 'vue'
import { BreadcrumbPosition, provideBreadcrumbs, type BreadcrumbKey } from './breadcrumbsContext'

const {
  testId,
  class: className,
  onAction,
  onDrop,
} = defineProps<{
  testId?: string | undefined
  class?: string | undefined
  /** An item was pressed. It must have an `id`. */
  onAction?: ((key: BreadcrumbKey) => unknown) | undefined
  /** Something was dropped on an item. It must have an `id`. */
  onDrop?: ((key: BreadcrumbKey, event: DragEvent) => unknown) | undefined
}>()

provideButtonGroup({ variant: 'icon' })
provideBreadcrumbs(() => ({ onAction, onDrop }))

const styles = BREADCRUMBS_STYLES()
const slots = useSlots()

/** The items, each with whether it is the current (last) one. Called while rendering. */
function items(): { node: VNode; isCurrent: boolean }[] {
  const nodes = flattenSlotChildren(slots.default?.() ?? [])
  return nodes.map((node, index) => ({ node, isCurrent: index === nodes.length - 1 }))
}
</script>

<template>
  <ol :class="styles.base({ className })" :data-testid="testId">
    <template v-for="({ node, isCurrent }, index) in items()" :key="node.key ?? index">
      <BreadcrumbPosition :isCurrent="isCurrent">
        <component :is="node" />
      </BreadcrumbPosition>
      <Icon icon="chevron_right" :class="styles.separator()" />
    </template>
  </ol>
</template>
