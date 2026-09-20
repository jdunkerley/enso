<script setup lang="ts">
import { useTooltipRegistry } from '@/providers/tooltipRegistry'
import { usePropagateScopesToAllRoots } from '@/util/patching'
import type { Placement } from '@floating-ui/vue'
import { toRef } from 'vue'

const {
  placement = 'top',
  enabled = true,
  showOnClick = false,
} = defineProps<{
  placement?: Placement
  enabled?: boolean
  showOnClick?: boolean
}>()

usePropagateScopesToAllRoots()

// `allowMissing: true` — `TooltipTrigger` (via `MenuButton`) can now be mounted from
// `GridPopupMenu` inside a visualization's custom-element subtree, where no ancestor provides the
// tooltip registry (only `App.vue` does, and Vue's provide/inject doesn't cross a custom-element
// boundary; see `GridPopupMenu.vue`'s comment on its own interaction-handler injection for the
// full story). Degrade gracefully there: with no registry, tooltips just never show, rather than
// the whole menu crashing on mount.
const registry = useTooltipRegistry(true)
const slots = defineSlots<{
  default(props: any): any
  tooltip(): any
}>()

const tooltipSlot = toRef(slots, 'tooltip')
const registered = registry?.registerTooltip(tooltipSlot)
function onEnter(e: PointerEvent) {
  if (registered && e.target instanceof HTMLElement && tooltipSlot.value != null) {
    registered.onTargetEnter(e.target, { placement: () => placement, enabled: () => enabled })
  }
}

function onLeave(e: PointerEvent) {
  if (registered && e.target instanceof HTMLElement && tooltipSlot.value != null) {
    registered.onTargetLeave(e.target)
  }
}

function onClick(e: MouseEvent) {
  if (registered && showOnClick && e.target instanceof HTMLElement && tooltipSlot.value != null) {
    registered.forceShow(e.target)
  }
}

defineExpose({
  hideTooltip() {
    registered?.forceHide()
  },
})
</script>

<template>
  <slot v-bind="{ ...$attrs }" @pointerenter="onEnter" @pointerleave="onLeave" @click="onClick" />
</template>
